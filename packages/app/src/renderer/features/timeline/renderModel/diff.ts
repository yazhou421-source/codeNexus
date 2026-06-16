// Diff 渲染模型：把文本 diff 解析为可渲染的行级结构，并标注增删改上下文。
export type DiffLineKind = "meta" | "hunk" | "add" | "del" | "ctx";
export type DiffLine = { kind: DiffLineKind; oldNo: number | null; newNo: number | null; text: string };

export type ParsedDiff = {
  lines: DiffLine[];
  truncated: boolean;
  isUnified: boolean;
};

export type DiffLineStats = {
  add: number;
  del: number;
  lineCount: number;
  structured: boolean;
};

const MAX_DIFF_LINES = 1400;
const parsedDiffCache = new Map<string, ParsedDiff>();

// 解析 unified diff 文本为行模型，供 UI 列表直接渲染。
export function parseUnifiedDiffLines(diffText: string): ParsedDiff {
  const text = String(diffText ?? "");
  const rawLines = text.split(/\r?\n/);
  const lines: DiffLine[] = [];
  let truncated = false;
  let isUnified = false;

  let inHunk = false;
  let oldNo = 0;
  let newNo = 0;

  // 超过上限后停止继续解析，防止超大 diff 卡界面。
  const push = (line: DiffLine) => {
    lines.push(line);
    if (lines.length >= MAX_DIFF_LINES) truncated = true;
  };

  for (let i = 0; i < rawLines.length; i += 1) {
    if (truncated) break;
    const line = rawLines[i] ?? "";

    if (line.startsWith("@@")) {
      const m = /@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/.exec(line);
      if (m) {
        isUnified = true;
        inHunk = true;
        oldNo = Math.max(0, Number.parseInt(m[1] || "0", 10));
        newNo = Math.max(0, Number.parseInt(m[3] || "0", 10));
      }
      push({ kind: "hunk", oldNo: null, newNo: null, text: line });
      continue;
    }

    if (/^(diff |index |--- |\+\+\+ )/.test(line)) {
      push({ kind: "meta", oldNo: null, newNo: null, text: line });
      continue;
    }

    if (inHunk && line.startsWith("+") && !line.startsWith("+++")) {
      push({ kind: "add", oldNo: null, newNo, text: line });
      newNo += 1;
      continue;
    }

    if (inHunk && line.startsWith("-") && !line.startsWith("---")) {
      push({ kind: "del", oldNo, newNo: null, text: line });
      oldNo += 1;
      continue;
    }

    if (inHunk) {
      push({ kind: "ctx", oldNo, newNo, text: line });
      oldNo += 1;
      newNo += 1;
      continue;
    }

    push({ kind: "ctx", oldNo: i + 1, newNo: null, text: line });
  }

  return { lines, truncated, isUnified };
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
  let add = 0;
  let del = 0;
  for (const line of parsed.lines) {
    if (line.kind === "add") add += 1;
    else if (line.kind === "del") del += 1;
  }

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
