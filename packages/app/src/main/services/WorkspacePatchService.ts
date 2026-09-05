import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { readWorkspaceGitDiff } from "./workspaceGitDiff";

type DiffHunkLine = { kind: "context" | "add" | "remove"; text: string };

type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffHunkLine[];
};

type FilePatch = {
  oldPath: string | null;
  newPath: string | null;
  hunks: DiffHunk[];
};

export type WorkspaceReverseDiffResult = { ok: true; files: string[] } | { ok: false; error: string; files?: string[] };

function normalizePatchPath(raw: string | null): string | null {
  if (!raw) return null;
  const source = raw.trim();
  if (!source) return null;
  let trimmed = source;
  if (trimmed.startsWith('"')) {
    const match = trimmed.match(/^"((?:[^"\\]|\\.)*)"/);
    if (match) trimmed = match[1]?.replace(/\\"/g, '"').replace(/\\\\/g, "\\") ?? "";
  } else {
    trimmed = trimmed.split("\t")[0] ?? "";
  }
  trimmed = trimmed.trim();
  if (!trimmed || trimmed === "/dev/null") return null;
  // 兼容 git diff 的 a/ b/ 前缀，统一转换为相对路径。
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) return trimmed.slice(2);
  return trimmed;
}

function parseHunkHeader(
  line: string
): { oldStart: number; oldLines: number; newStart: number; newLines: number } | null {
  // 解析 hunk 头：`@@ -oldStart,oldLines +newStart,newLines @@`
  const m = line.match(/^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/);
  if (!m) return null;
  const oldStart = Number(m[1]);
  const oldLines = m[2] ? Number(m[2]) : 1;
  const newStart = Number(m[3]);
  const newLines = m[4] ? Number(m[4]) : 1;
  if (
    !Number.isFinite(oldStart) ||
    !Number.isFinite(oldLines) ||
    !Number.isFinite(newStart) ||
    !Number.isFinite(newLines)
  )
    return null;
  return { oldStart, oldLines, newStart, newLines };
}

function parseUnifiedDiff(diffText: string): FilePatch[] {
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  const patches: FilePatch[] = [];

  let current: FilePatch | null = null;
  let currentHunk: DiffHunk | null = null;

  const flushHunk = () => {
    if (!current || !currentHunk) return;
    current.hunks.push(currentHunk);
    currentHunk = null;
  };

  const flushFile = () => {
    flushHunk();
    if (!current) return;
    if (current.oldPath || current.newPath || current.hunks.length > 0) {
      patches.push(current);
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine;

    if (line.startsWith("diff --git ")) {
      flushFile();
      current = { oldPath: null, newPath: null, hunks: [] };
      continue;
    }

    if (!current) {
      // 兼容省略 diff --git 头部、直接以 ---/+++ 开头的补丁。
      if (line.startsWith("--- ")) {
        current = { oldPath: null, newPath: null, hunks: [] };
      } else {
        continue;
      }
    }

    if (line.startsWith("--- ")) {
      flushHunk();
      current.oldPath = normalizePatchPath(line.slice(4).trim());
      continue;
    }

    if (line.startsWith("+++ ")) {
      flushHunk();
      current.newPath = normalizePatchPath(line.slice(4).trim());
      continue;
    }

    if (line.startsWith("@@")) {
      flushHunk();
      const header = parseHunkHeader(line);
      if (!header) continue;
      currentHunk = { ...header, lines: [] };
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith("\\ No newline at end of file")) {
      continue;
    }

    const prefix = line.slice(0, 1);
    const text = line.slice(1);
    if (prefix === " ") currentHunk.lines.push({ kind: "context", text });
    else if (prefix === "+") currentHunk.lines.push({ kind: "add", text });
    else if (prefix === "-") currentHunk.lines.push({ kind: "remove", text });
    else {
      // 遇到异常行时按上下文处理，尽量保留补丁信息避免丢失。
      currentHunk.lines.push({ kind: "context", text: line });
    }
  }

  flushFile();
  return patches;
}

function ensurePathInsideCwd(cwd: string, relPath: string): string {
  const clean = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || isAbsolute(clean) || clean.includes(":")) {
    throw new Error(`invalid path in diff: ${relPath}`);
  }
  const root = resolve(cwd);
  const full = resolve(root, clean);
  const rootNorm = root.toLowerCase();
  const fullNorm = full.toLowerCase();
  const rootWithSep = rootNorm.endsWith(sep) ? rootNorm : `${rootNorm}${sep}`;
  // 防止补丁通过 ../ 或绝对路径写出工作区之外。
  if (!(fullNorm === rootNorm || fullNorm.startsWith(rootWithSep))) {
    throw new Error(`refuse to access file outside cwd: ${relPath}`);
  }
  return full;
}

function splitPreserveTrailingNewline(text: string): {
  lines: string[];
  hadTrailingNewline: boolean;
  eol: "\n" | "\r\n";
} {
  const eol: "\n" | "\r\n" = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = text.replace(/\r\n/g, "\n");
  const hadTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (hadTrailingNewline) lines.pop();
  return { lines, hadTrailingNewline, eol };
}

function joinPreserveTrailingNewline(lines: string[], hadTrailingNewline: boolean, eol: "\n" | "\r\n"): string {
  const joined = lines.join(eol);
  return hadTrailingNewline ? `${joined}${eol}` : joined;
}

function invertLineKind(kind: DiffHunkLine["kind"]): DiffHunkLine["kind"] {
  if (kind === "add") return "remove";
  if (kind === "remove") return "add";
  return "context";
}

function hunkStartForDirection(hunk: DiffHunk, reverse: boolean): number {
  return reverse ? hunk.newStart : hunk.oldStart;
}

function hunkLinesForDirection(hunk: DiffHunk, reverse: boolean): DiffHunkLine[] {
  if (!reverse) return hunk.lines;
  return hunk.lines.map((l) => ({ kind: invertLineKind(l.kind), text: l.text }));
}

function findHunkApplyIndex(fileLines: string[], startIndex: number, pattern: string[]): number | null {
  const matchesAt = (idx: number) => {
    if (idx < 0) return false;
    if (idx + pattern.length > fileLines.length) return false;
    for (let i = 0; i < pattern.length; i++) {
      if (fileLines[idx + i] !== pattern[i]) return false;
    }
    return true;
  };

  if (matchesAt(startIndex)) return startIndex;

  // 允许小范围漂移，兼容文件有轻微位移但上下文仍一致的场景。
  const MAX_DRIFT = 50;
  let found: number | null = null;
  for (let d = 1; d <= MAX_DRIFT; d++) {
    const left = startIndex - d;
    const right = startIndex + d;
    if (matchesAt(left)) {
      if (found != null) return null;
      found = left;
    }
    if (matchesAt(right)) {
      if (found != null) return null;
      found = right;
    }
  }
  return found;
}

function applyHunksToText(originalText: string, hunks: DiffHunk[], reverse: boolean): string {
  const { lines: originalLines, hadTrailingNewline, eol } = splitPreserveTrailingNewline(originalText);
  let lines = originalLines.slice();

  for (const hunk of hunks) {
    const start = Math.max(1, hunkStartForDirection(hunk, reverse));
    const expectedIndex = Math.max(0, Math.min(lines.length, start - 1));
    const effectiveLines = hunkLinesForDirection(hunk, reverse);
    const matchPattern = effectiveLines.filter((l) => l.kind !== "add").map((l) => l.text);

    const applyIndex = findHunkApplyIndex(lines, expectedIndex, matchPattern);
    if (applyIndex == null) {
      throw new Error(`hunk does not apply (context mismatch) at ~L${start}`);
    }

    const before = lines.slice(0, applyIndex);
    const afterStart = applyIndex + matchPattern.length;
    const after = lines.slice(afterStart);

    const resultSegment: string[] = [];
    let cursor = applyIndex;
    for (const l of effectiveLines) {
      if (l.kind === "context") {
        resultSegment.push(lines[cursor]);
        cursor += 1;
        continue;
      }
      if (l.kind === "remove") {
        cursor += 1;
        continue;
      }
      if (l.kind === "add") {
        resultSegment.push(l.text);
        continue;
      }
    }

    lines = before.concat(resultSegment, after);
  }

  return joinPreserveTrailingNewline(lines, hadTrailingNewline, eol);
}

async function readTextFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (e: any) {
    if (e?.code === "ENOENT") return false;
    throw e;
  }
}

export class WorkspacePatchService {
  readGitDiff(args: { cwd: string }) {
    return readWorkspaceGitDiff(args?.cwd);
  }
  async dryRunApplyReverseDiff(args: { cwd: string; diffText: string }): Promise<WorkspaceReverseDiffResult> {
    try {
      const { files } = await this.applyReverseDiffInternal(args, { dryRun: true });
      return { ok: true, files };
    } catch (e: any) {
      return { ok: false, error: e?.message ? String(e.message) : String(e) };
    }
  }

  async applyReverseDiff(args: { cwd: string; diffText: string }): Promise<WorkspaceReverseDiffResult> {
    try {
      const { files } = await this.applyReverseDiffInternal(args, { dryRun: false });
      return { ok: true, files };
    } catch (e: any) {
      return { ok: false, error: e?.message ? String(e.message) : String(e) };
    }
  }

  private async applyReverseDiffInternal(
    args: { cwd: string; diffText: string },
    opts: { dryRun: boolean }
  ): Promise<{ files: string[] }> {
    const cwd = typeof args?.cwd === "string" ? args.cwd.trim() : "";
    const diffText = typeof args?.diffText === "string" ? args.diffText : "";
    if (!cwd) throw new Error("missing cwd");
    if (!diffText.trim()) return { files: [] };

    const patches = parseUnifiedDiff(diffText);
    if (patches.length === 0) return { files: [] };

    const touched = new Set<string>();
    const markTouched = (relPath: string | null | undefined) => {
      const rel = String(relPath ?? "").trim();
      if (rel) touched.add(rel);
    };

    for (const patch of patches) {
      const oldRel = patch.oldPath;
      const newRel = patch.newPath;
      const oldAbs = oldRel ? ensurePathInsideCwd(cwd, oldRel) : null;
      const newAbs = newRel ? ensurePathInsideCwd(cwd, newRel) : null;

      if (!oldRel && !newRel) continue;

      const wasNewFile = oldRel == null && newRel != null;
      if (wasNewFile) {
        // 反向回滚：新增文件对应删除文件。
        if (!opts.dryRun) {
          try {
            if (newAbs) await unlink(newAbs);
          } catch (e: any) {
            if (e?.code !== "ENOENT") throw e;
          }
        } else {
          // dry-run 仅做路径合法性校验，不落盘。
          void newAbs;
        }
        markTouched(newRel);
        continue;
      }

      const isRename = Boolean(oldRel && newRel && oldRel !== newRel);
      if (isRename) {
        const sourceAbs = newAbs && (await fileExists(newAbs)) ? newAbs : oldAbs;
        if (!sourceAbs || !oldAbs) {
          throw new Error(`invalid rename rollback target: ${oldRel ?? "(missing)"} <- ${newRel ?? "(missing)"}`);
        }
        const renameOnly = patch.hunks.length === 0;
        if (renameOnly) {
          if (!opts.dryRun && sourceAbs !== oldAbs) {
            if (await fileExists(oldAbs)) {
              throw new Error(`cannot rollback rename: destination already exists (${oldRel})`);
            }
            await mkdir(dirname(oldAbs), { recursive: true });
            await rename(sourceAbs, oldAbs);
          }
          markTouched(oldRel);
          if (sourceAbs !== oldAbs) markTouched(newRel);
          continue;
        }

        const sourceContent = (await readTextFileIfExists(sourceAbs)) ?? "";
        const next = applyHunksToText(sourceContent, patch.hunks, true);
        if (!opts.dryRun) {
          await mkdir(dirname(oldAbs), { recursive: true });
          await writeFile(oldAbs, next, "utf8");
          if (sourceAbs !== oldAbs) {
            try {
              await unlink(sourceAbs);
            } catch (e: any) {
              if (e?.code !== "ENOENT") throw e;
            }
          }
        }
        markTouched(oldRel);
        if (sourceAbs !== oldAbs) markTouched(newRel);
        continue;
      }

      const targetRel = oldRel ?? newRel;
      if (!targetRel) continue;
      const abs = oldAbs ?? newAbs;
      if (!abs) continue;

      const content = (await readTextFileIfExists(abs)) ?? "";
      const next = applyHunksToText(content, patch.hunks, true);

      if (!opts.dryRun) {
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, next, "utf8");
      }
      markTouched(targetRel);
    }

    return { files: [...touched] };
  }
}
