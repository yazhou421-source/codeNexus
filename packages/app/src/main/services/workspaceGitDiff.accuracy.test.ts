import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkspaceGitDiff } from "./workspaceGitDiff";
import {
  getDiffLineStats,
  parseUnifiedDiffLines,
  selectReviewDiff,
} from "../../renderer/features/timeline/renderModel/diff";
let root: string;
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe" });
const write = (name: string, text: string) => writeFile(join(root, name), text);
const baseline = "first\nmiddle\nlast\n";
function stats(numstat: string) {
  return numstat
    .trim()
    .split("\n")
    .filter(Boolean)
    .reduce(
      (total, row) => {
        const [add, del] = row.split("\t").map(Number);
        return { add: total.add + add, del: total.del + del };
      },
      { add: 0, del: 0 }
    );
}
async function assertGit(cwd = root) {
  const result = await readWorkspaceGitDiff(cwd);
  const relative = cwd === root ? [] : ["--relative=sub"];
  const expected = stats(git("diff", "--numstat", "--no-renames", ...relative, "HEAD", "--", cwd));
  const stat = git("diff", "--stat", "--no-renames", ...relative, "HEAD", "--", cwd);
  expect(result.status).toBe("ok");
  expect(result.skipped).toBe(0);
  expect(getDiffLineStats(result.diffText), stat).toMatchObject(expected);
  // Summary card uses these complete parser stats, independently of visual row truncation.
  expect(parseUnifiedDiffLines(result.diffText).stats).toEqual(expected);
  return result;
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "calmnova-diff-accuracy-"));
  git("init");
  git("config", "core.autocrlf", "false");
  await write("tracked.txt", baseline);
  git("add", ".");
  // A baseline commit only inside this disposable test repository.
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture baseline");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("Git source → renderer exact line statistics", () => {
  it.each([
    ["single added line", "first\nnew\nmiddle\nlast\n", 1, 0],
    ["single deleted line", "first\nlast\n", 0, 1],
    ["one modified line", "first\nchanged\nlast\n", 1, 1],
    ["header-like added content", "first\n++ heading\n-- heading\nlast\n", 2, 1],
    ["no trailing newline", "first\nmiddle\nlast", 1, 1],
  ])("%s matches numstat and stat", async (_name, content, add, del) => {
    await write("tracked.txt", String(content));
    expect(getDiffLineStats((await assertGit()).diffText)).toMatchObject({ add, del });
  });
  it("multiple files, including a staged new file", async () => {
    await write("tracked.txt", "first\nchanged\nlast\n");
    await write("new.txt", "one\ntwo\n");
    git("add", "new.txt");
    await assertGit();
  });
  it("untracked new file matches Git's empty-file baseline", async () => {
    await write("new.txt", "one\ntwo\n");
    let numstat = "";
    try {
      git("diff", "--no-index", "--numstat", "/dev/null", join(root, "new.txt"));
    } catch (error: any) {
      expect(error.status).toBe(1);
      numstat = error.stdout;
    }
    expect(getDiffLineStats((await readWorkspaceGitDiff(root)).diffText)).toMatchObject(stats(numstat));
  });
  it("deleted file", async () => {
    await rm(join(root, "tracked.txt"));
    await assertGit();
  });
  it("existing workspace edits plus current turn are never concatenated", async () => {
    const existing = "existing\nmiddle\nlast\n";
    await write("tracked.txt", existing);
    git("add", "tracked.txt");
    await write("tracked.txt", "existing\nmiddle\nturn edit\n");
    const index = git("diff", "--cached");
    const turn = git("diff"); // The index captures the existing workspace baseline in this fixture.
    const workspace = await assertGit();
    expect(getDiffLineStats(selectReviewDiff(workspace, turn).diffText)).toMatchObject({ add: 2, del: 2 });
    expect(getDiffLineStats(selectReviewDiff(workspace, turn, true).diffText)).toMatchObject(
      stats(git("diff", "--numstat"))
    );
    expect(selectReviewDiff({ status: "ok", diffText: "" }, turn).diffText).toBe(turn);
    expect(git("diff", "--cached")).toBe(index);
  });
  it.each(["false", "true"])("CRLF conversion follows Git core.autocrlf=%s", async (setting) => {
    git("config", "core.autocrlf", setting);
    await write("tracked.txt", "first\r\nchanged\r\nlast\r\n");
    await assertGit();
  });
  it("display truncation does not truncate statistics", async () => {
    await write("tracked.txt", baseline + "added\n".repeat(1600));
    const result = await assertGit();
    expect(parseUnifiedDiffLines(result.diffText).truncated).toBe(true);
    expect(getDiffLineStats(result.diffText).add).toBe(1600);
  });
  it("sub-workspace paths retain real hunks and correct counts", async () => {
    await mkdir(join(root, "sub"));
    await write("sub/a.txt", baseline);
    git("add", "sub/a.txt");
    await assertGit(join(root, "sub"));
  });
});
