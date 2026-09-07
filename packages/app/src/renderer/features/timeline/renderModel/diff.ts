// Diff 渲染模型：把文本 diff 解析为可渲染的行级结构，并标注增删改上下文。
export type DiffLineKind = "meta" | "hunk" | "add" | "del" | "ctx";
export type DiffLine = { kind: DiffLineKind; oldNo: number | null; newNo: number | null; text: string };

export type ParsedDiff = {
  lines: DiffLine[];
  truncated: boolean;
  isUnified: boolean;
  stats: { add: number; del: number };
};

export type DiffLineStats = {
  add: number;
  del: number;
  lineCount: number;
  structured: boolean;
};

const MAX_DIFF_LINES = 1400;
const parsedDiffCache = new Map<string, ParsedDiff>();

// 解析 unified diff 文本为行模型，供 Vue 列表直接渲染。
export function parseUnifiedDiffLines(diffText: string): ParsedDiff {
  const rawLines = String(diffText ?? "").split(/\r?\n/);
  const lines: DiffLine[] = [];
  const stats = { add: 0, del: 0 };
  let truncated = false,
    isUnified = false;
  let oldNo = 0,
    newNo = 0,
    oldRemaining = 0,
    newRemaining = 0;
  const push = (line: DiffLine) => {
    if (line.kind === "add") stats.add += 1;
    if (line.kind === "del") stats.del += 1;
    if (lines.length < MAX_DIFF_LINES) lines.push(line);
    else truncated = true;
  };
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i] ?? "";
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      isUnified = true;
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[3]);
      oldRemaining = Number(hunk[2] ?? 1);
      newRemaining = Number(hunk[4] ?? 1);
      push({ kind: "hunk", oldNo: null, newNo: null, text: line });
      continue;
    }
    // Hunk contents take priority over header-like content (e.g. an added '++ title').
    if (oldRemaining || newRemaining) {
      if (line.startsWith("+") && newRemaining > 0) {
        push({ kind: "add", oldNo: null, newNo: newNo++, text: line });
        newRemaining--;
        continue;
      }
      if (line.startsWith("-") && oldRemaining > 0) {
        push({ kind: "del", oldNo: oldNo++, newNo: null, text: line });
        oldRemaining--;
        continue;
      }
      if (line.startsWith(" ") && oldRemaining > 0 && newRemaining > 0) {
        push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line });
        oldRemaining--;
        newRemaining--;
        continue;
      }
      if (line.startsWith("\\ No newline")) {
        push({ kind: "meta", oldNo: null, newNo: null, text: line });
        continue;
      }
      oldRemaining = 0;
      newRemaining = 0;
    }
    const metadata =
      isUnified || /^(diff |index |--- |\+\+\+ |new file |deleted file |rename |\\ No newline)/.test(line);
    push({ kind: metadata ? "meta" : "ctx", oldNo: metadata ? null : i + 1, newNo: null, text: line });
  }
  return { lines, truncated, isUnified, stats };
}

// 读取/写入解析缓存，避免同一 diff 反复 parse。
export function getParsedDiffCached(diffText: string): ParsedDiff {
  const key = String(diffText ?? "");
  const cached = parsedDiffCache.get(key);
  if (cached) return cached;
  const parsed = parseUnifiedDiffLines(key);
  parsedDiffCache.set(key, parsed);
  return parsed;
}

const countContentLines = (text: string): number => {
  const normalized = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n$/, "");
  if (!normalized.trim()) return 0;
  return normalized.split("\n").length;
};

const countPatchPrefixedLines = (text: string): { add: number; del: number } => {
  const rawLines = String(text ?? "").split(/\r?\n/);
  const looksLikePatch = rawLines.some((line) => /^\*\*\* (Add|Delete|Update) File: /.test(line));
  if (!looksLikePatch) return { add: 0, del: 0 };

  let add = 0;
  let del = 0;
  for (const line of rawLines) {
    if (line.startsWith("+") && !line.startsWith("+++")) add += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) del += 1;
  }
  return { add, del };
};

export function getDiffLineStats(diffText: string, fileKind = ""): DiffLineStats {
  const text = String(diffText ?? "");
  if (!text.trim()) return { add: 0, del: 0, lineCount: 0, structured: false };

  const parsed = getParsedDiffCached(text);
  const { add, del } = parsed.stats;

  if (add > 0 || del > 0 || parsed.isUnified) {
    return { add, del, lineCount: add + del, structured: true };
  }

  const patchStats = countPatchPrefixedLines(text);
  if (patchStats.add > 0 || patchStats.del > 0) {
    return {
      add: patchStats.add,
      del: patchStats.del,
      lineCount: patchStats.add + patchStats.del,
      structured: true,
    };
  }

  const fallbackLineCount = countContentLines(text);
  if (fileKind === "add") return { add: fallbackLineCount, del: 0, lineCount: fallbackLineCount, structured: false };
  if (fileKind === "delete") return { add: 0, del: fallbackLineCount, lineCount: fallbackLineCount, structured: false };

  return { add: 0, del: 0, lineCount: fallbackLineCount, structured: false };
}

export function getParsedDiffCacheStats(): { items: number; bytes: number; updatedAt: number } {
  let bytes = 0;
  for (const [key, value] of parsedDiffCache.entries()) {
    bytes += key.length;
    bytes += JSON.stringify(value).length;
  }
  return {
    items: parsedDiffCache.size,
    bytes: Math.max(0, Math.round(bytes)),
    updatedAt: Date.now(),
  };
}

export function clearParsedDiffCache(): void {
  parsedDiffCache.clear();
}

/** Select one explicit baseline; never double count native turn changes inside a HEAD diff. */
export function selectReviewDiff(workspace: { status: string; diffText: string }, turn: string, preferNative = false) {
  const isWorkspace = workspace.status === "ok" && Boolean(workspace.diffText || !turn) && (!preferNative || !turn);
  return { isWorkspace, diffText: isWorkspace ? workspace.diffText : turn };
}
