import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, rename, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { WorkspacePatchService } from "./WorkspacePatchService";
let root: string;
const service = new WorkspacePatchService();
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "calmnova-workspace-diff-"));
  git("init");
  await writeFile(join(root, "tracked.txt"), "before\n");
  git("add", "tracked.txt");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("bounded workspace Git diff", () => {
  it("shows a newly created file against an empty baseline", async () => {
    await writeFile(join(root, "new.txt"), "new content\n");
    const r = await service.readGitDiff({ cwd: root });
    expect(r.status).toBe("ok");
    expect(r.diffText).toContain("--- /dev/null");
    expect(r.diffText).toContain("+new content");
  });
  it("uses Git HEAD rather than guessing before contents", async () => {
    await writeFile(join(root, "tracked.txt"), "after\n");
    const r = await service.readGitDiff({ cwd: root });
    expect(r.diffText).toContain("-before");
    expect(r.diffText).toContain("+after");
  });
  it("includes staged and unstaged changes without changing the index", async () => {
    await writeFile(join(root, "tracked.txt"), "staged\n");
    git("add", "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "final\n");
    const index = git("diff", "--cached").toString();
    const r = await service.readGitDiff({ cwd: root });
    expect(r.diffText).toContain("-before");
    expect(r.diffText).toContain("+final");
    expect(git("diff", "--cached").toString()).toBe(index);
  });
  it("shows deletion", async () => {
    await rm(join(root, "tracked.txt"));
    expect((await service.readGitDiff({ cwd: root })).diffText).toContain("+++ /dev/null");
  });
  it("shows rename safely as deletion and addition", async () => {
    await rename(join(root, "tracked.txt"), join(root, "renamed.txt"));
    const r = await service.readGitDiff({ cwd: root });
    expect(r.diffText).toContain("a/tracked.txt");
    expect(r.diffText).toContain("b/renamed.txt");
  });
  it("deduplicates unchanged snapshots and does not emit protocol patches", async () => {
    await writeFile(join(root, "tracked.txt"), "after\n");
    const a = await service.readGitDiff({ cwd: root });
    expect(await service.readGitDiff({ cwd: root })).toEqual(a);
    expect(a).not.toHaveProperty("turnId");
  });
  it.each(["binary", "large"])("skips %s without returning contents", async (kind) => {
    await writeFile(join(root, "skip.txt"), kind === "binary" ? Buffer.from([0, 1, 2]) : "x".repeat(300_000));
    const r = await service.readGitDiff({ cwd: root });
    expect(r.diffText).toBe("");
    expect(r.skipped).toBeGreaterThan(0);
  });
  it("does not follow symlinks or include paths outside a sub-workspace", async () => {
    const sub = join(root, "sub");
    await mkdir(sub);
    await writeFile(join(root, "outside.txt"), "outside\n");
    await symlink(join(root, "outside.txt"), join(sub, "link.txt"));
    const r = await service.readGitDiff({ cwd: sub });
    expect(r.diffText).not.toContain("outside");
    expect(r.diffText).not.toContain("link.txt");
  });
  it("ignores noisy directories even when they are not gitignored", async () => {
    for (const dir of ["node_modules", "dist", "release"]) {
      await mkdir(join(root, dir));
      await writeFile(join(root, dir, "noise.txt"), "noise");
    }
    expect((await service.readGitDiff({ cwd: root })).diffText).toBe("");
  });
  it("degrades non-Git directories without a filesystem snapshot", async () => {
    await rm(join(root, ".git"), { recursive: true, force: true });
    expect(await service.readGitDiff({ cwd: root })).toMatchObject({ status: "not_git", diffText: "" });
  });
});
