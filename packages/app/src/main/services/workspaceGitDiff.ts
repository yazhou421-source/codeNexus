import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceGitDiffResult } from "@codenexus/shared/ipc/contracts";

const exec = promisify(execFile);
const FILE_LIMIT = 256 * 1024;
const TOTAL_LIMIT = 2 * 1024 * 1024;
const FILE_COUNT_LIMIT = 32;
const ignored = ["node_modules", ".git", "dist", "release", ".cache"];
const within = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};

async function git(cwd: string, args: string[], maxBuffer = FILE_LIMIT) {
  const result = await exec(
    "git",
    ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=", "-C", cwd, ...args],
    {
      windowsHide: true,
      timeout: 3000,
      maxBuffer,
      encoding: "buffer",
    }
  );
  return result.stdout;
}

function text(buffer: Buffer): string {
  if (buffer.includes(0)) throw new Error("non-text");
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

async function readCurrent(root: string, path: string): Promise<string | null> {
  // Reject symlink parents as well as leaf symlinks; never follow them outside cwd.
  let part = root;
  for (const segment of relative(root, path).split(sep)) {
    part = resolve(part, segment);
    try {
      if ((await lstat(part)).isSymbolicLink()) throw new Error("symlink");
    } catch (error: any) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  if (!within(root, await realpath(path))) throw new Error("outside workspace");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > FILE_LIMIT) throw new Error("unsupported size/type");
    const bytes = Buffer.alloc(FILE_LIMIT + 1);
    let count = 0;
    while (count < bytes.length) {
      const chunk = await handle.read(bytes, count, bytes.length - count, count);
      if (!chunk.bytesRead) break;
      count += chunk.bytesRead;
    }
    if (count > FILE_LIMIT) throw new Error("file grew");
    return text(bytes.subarray(0, count));
  } finally {
    await handle.close();
  }
}

function wholeFileDiff(path: string, before: string | null, after: string | null): string {
  if (before === after) return "";
  const lines = (value: string | null) => (value ? value.replace(/\n$/, "").split("\n") : []);
  const oldLines = lines(before),
    newLines = lines(after);
  const headerPath = (prefix: string) => JSON.stringify(`${prefix}/${path}`);
  const out = [`diff --git ${headerPath("a")} ${headerPath("b")}`];
  if (before === null) out.push("new file mode 100644");
  if (after === null) out.push("deleted file mode 100644");
  out.push(
    `--- ${before === null ? "/dev/null" : headerPath("a")}`,
    `+++ ${after === null ? "/dev/null" : headerPath("b")}`,
    `@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@`
  );
  for (const [prefix, value, content] of [
    ["-", oldLines, before],
    ["+", newLines, after],
  ] as const) {
    out.push(...value.map((line) => prefix + line));
    if (content && !content.endsWith("\n")) out.push("\\ No newline at end of file");
  }
  return out.join("\n") + "\n";
}

/** Read-only, bounded Git HEAD → working tree snapshot; never a fabricated native turn patch. */
export async function readWorkspaceGitDiff(cwd: string): Promise<WorkspaceGitDiffResult> {
  const empty = (status: WorkspaceGitDiffResult["status"]): WorkspaceGitDiffResult => ({
    status,
    diffText: "",
    skipped: 0,
  });
  if (!cwd || !isAbsolute(cwd)) return empty("unavailable");
  let workspace: string, root: string;
  try {
    workspace = await realpath(cwd);
    root = await realpath((await git(workspace, ["rev-parse", "--show-toplevel"])).toString().trim());
    if (!within(root, workspace)) return empty("unavailable");
  } catch {
    return empty("not_git");
  }
  try {
    let head: string | null = null;
    try {
      head = (await git(root, ["rev-parse", "--verify", "HEAD"])).toString().trim();
    } catch {
      /* unborn repository */
    }
    const status = (
      await git(
        workspace,
        [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--no-renames",
          "--",
          ".",
          ...ignored.map((dir) => `:(glob,exclude)**/${dir}/**`),
        ],
        512 * 1024
      )
    ).toString();
    const paths = [
      ...new Set(
        status
          .split("\0")
          .filter(Boolean)
          .map((entry) => entry.slice(3))
      ),
    ];
    let skipped = Math.max(0, paths.length - FILE_COUNT_LIMIT),
      diffText = "";
    for (const name of paths.slice(0, FILE_COUNT_LIMIT)) {
      if (
        /[\x00-\x1f\\]/.test(name) ||
        isAbsolute(name) ||
        name.split("/").some((p) => p === ".." || ignored.includes(p))
      ) {
        skipped++;
        continue;
      }
      const full = resolve(root, name);
      if (!within(workspace, full)) continue;
      try {
        let before: string | null = null;
        if (head) {
          const tree = (await git(root, ["--literal-pathspecs", "ls-tree", "-z", head, "--", name])).toString();
          if (tree) {
            if (!/^100(?:644|755) blob /.test(tree)) throw new Error("non-regular base");
            const oid = tree.split("\t")[0].split(" ")[2];
            const size = Number((await git(root, ["cat-file", "-s", oid])).toString());
            if (!Number.isFinite(size) || size > FILE_LIMIT) throw new Error("large base");
            before = text(await git(root, ["cat-file", "blob", oid], FILE_LIMIT + 1));
          }
        }
        const after = await readCurrent(workspace, full);
        const patch = wholeFileDiff(relative(workspace, full).split(sep).join("/"), before, after);
        if (Buffer.byteLength(diffText) + Buffer.byteLength(patch) > TOTAL_LIMIT) {
          skipped++;
          continue;
        }
        diffText += patch;
      } catch {
        skipped++;
      }
    }
    return { status: "ok", diffText, skipped };
  } catch {
    return empty("unavailable");
  }
}
