import { readFileSync, writeFileSync, unlinkSync, renameSync, mkdirSync, statSync, readdirSync, existsSync, type Dirent } from "node:fs";
import { resolve, relative, isAbsolute, join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import https from "node:https";
import http from "node:http";
import { createTwoFilesPatch } from "diff";
import { parseHTML } from "linkedom";
import type { ToolDefinition } from "./types";

/**
 * Workspace tools for code-focused tasks: search, grep, range reading, Git operations, and patch-based editing.
 * All tools are sandboxed to rootDir. Write operations require approval.
 */

const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_LINES = 500;
const DEFAULT_LINE_COUNT = 200;
const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_MAX_MATCHES = 100;
const MAX_PREVIEW_CHARS = 4000;

const IGNORE_DIRS = new Set([".git", "node_modules", "dist", "build", ".cache", "coverage"]);

export interface WorkspaceToolsOptions {
  /**
   * Optional approval hook for write operations (apply_patch, delete_file, move_file, mkdir).
   * Returns false to reject the operation.
   */
  requireApproval?: (op: { tool: string; details: string }) => Promise<boolean> | boolean;
}

/** Clamp output to last N bytes (preserves recent content). */
function clampOutput(text: string, limit: number = MAX_OUTPUT_BYTES): string {
  if (text.length <= limit) return text;
  const truncated = text.slice(-limit);
  return `... [truncated, showing last ${limit} bytes]\n${truncated}`;
}

/** Validate path is inside rootDir sandbox. */
function resolveInsideRoot(rootDir: string, userPath: unknown): string {
  const root = resolve(rootDir);
  const raw = String(userPath ?? "").trim();
  if (!raw) throw new Error("path is required");
  const target = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`path escapes sandbox root: ${raw}`);
  }
  return target;
}

/** Get relative path for display. */
function getRelativePath(rootDir: string, absPath: string): string {
  return join(".", relative(resolve(rootDir), absPath));
}

/** Truncate preview text for approval dialogs. */
function clampPreview(text: string): string {
  return text.length > MAX_PREVIEW_CHARS
    ? `${text.slice(0, MAX_PREVIEW_CHARS)}… (${text.length - MAX_PREVIEW_CHARS} more chars)`
    : text;
}

/** Fetch JSON from a URL using https module. */
function fetchJSON(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Invalid JSON response"));
        }
      });
    }).on("error", reject);
  });
}

/** Search DuckDuckGo for query results. */
async function duckDuckGoSearch(query: string, maxResults: number = 10): Promise<Array<{ title: string; snippet: string; url: string }>> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;
  const data = await fetchJSON(url);

  const results: Array<{ title: string; snippet: string; url: string }> = [];

  // Add abstract if available
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || "Summary",
      snippet: data.AbstractText,
      url: data.AbstractURL,
    });
  }

  // Add related topics
  for (const topic of data.RelatedTopics || []) {
    if (topic.Text && topic.FirstURL) {
      results.push({
        title: topic.Text.split(" - ")[0] || topic.Text,
        snippet: topic.Text,
        url: topic.FirstURL,
      });
    }
    if (results.length >= maxResults) break;
  }

  return results;
}

/** Compute unified diff between two strings with proper context. */
function computeDiff(original: string, updated: string, filename: string = "file"): string {
  const patch = createTwoFilesPatch(
    filename,
    filename,
    original,
    updated,
    "",
    "",
    { context: 3 }
  );

  // Extract just the hunks (skip file headers)
  const lines = patch.split("\n");
  const hunkStart = lines.findIndex((l) => l.startsWith("@@"));
  if (hunkStart < 0) return ""; // No changes

  return lines.slice(hunkStart).join("\n");
}

/** Extract main content from HTML, removing scripts/styles/navigation. */
function extractMainContent(html: string): string {
  try {
    const { document } = parseHTML(html);

    // Remove script and style tags
    document.querySelectorAll("script, style, noscript, iframe").forEach((el: any) => el.remove());

    // Try to find main content area
    const main =
      document.querySelector("main") ||
      document.querySelector("article") ||
      document.querySelector('[role="main"]') ||
      document.querySelector(".content") ||
      document.querySelector("#content") ||
      document.body;

    if (!main) return document.body.textContent || "";

    // Get text content
    let text = main.textContent || "";

    // Clean up whitespace
    text = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    return text;
  } catch (error) {
    return html;
  }
}

/** Generate extractive summary by selecting key sentences from text. */
function extractiveSummary(text: string, maxSentences: number = 5): string {
  // Split into sentences
  const allSentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 300); // Filter too short/long

  if (allSentences.length <= maxSentences) return ""; // No summary needed

  // Score sentences by position, length, and keyword density
  const scored = allSentences.map((sent, idx) => {
    const positionScore = 1 / (idx + 1); // Earlier sentences score higher
    const lengthScore = Math.min(sent.length / 100, 1); // Prefer medium-length
    const keywordScore = (
      sent.match(
        /\b(API|function|method|class|interface|type|documentation|example|usage|feature|parameter|return|error|exception|implement|provide|allow|enable|support)\b/gi
      ) || []
    ).length;

    return {
      text: sent,
      index: idx,
      score: positionScore * 2 + lengthScore + keywordScore * 0.5,
    };
  });

  // Take top N sentences, maintain original order
  const topSentences = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index);

  return topSentences.map((s) => s.text).join(". ") + ".";
}

/** Recursively search files/directories, excluding ignored paths. */
function* walkFiles(dir: string, rootDir: string): Generator<{ path: string; isDirectory: boolean }> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Skip inaccessible directories
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    yield { path: relPath, isDirectory: entry.isDirectory() };

    if (entry.isDirectory()) {
      yield* walkFiles(fullPath, rootDir);
    }
  }
}

/** Parse unified diff format into hunks. */
interface PatchHunk {
  file: string;
  operation: "create" | "modify" | "delete";
  newContent?: string;
  hunks?: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }>;
}

function parsePatch(patch: string): PatchHunk[] {
  const lines = patch.split("\n");
  const result: PatchHunk[] = [];
  let currentFile: PatchHunk | null = null;
  let currentHunk: NonNullable<PatchHunk["hunks"]>[0] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // File header: --- a/path or --- /dev/null
    if (line.startsWith("--- ")) {
      const nextLine = lines[i + 1];
      if (nextLine?.startsWith("+++ ")) {
        const oldPath = line.slice(4).replace(/^a\//, "");
        const newPath = nextLine.slice(4).replace(/^b\//, "");

        if (currentFile) result.push(currentFile);

        if (oldPath === "/dev/null") {
          currentFile = { file: newPath, operation: "create", hunks: [] };
        } else if (newPath === "/dev/null") {
          currentFile = { file: oldPath, operation: "delete" };
        } else {
          currentFile = { file: newPath, operation: "modify", hunks: [] };
        }
        i++; // Skip the +++ line
      }
    }
    // Hunk header: @@ -1,3 +1,4 @@
    else if (line.startsWith("@@") && currentFile) {
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        if (currentHunk) currentFile.hunks?.push(currentHunk);
        currentHunk = {
          oldStart: parseInt(match[1]),
          oldLines: parseInt(match[2] || "1"),
          newStart: parseInt(match[3]),
          newLines: parseInt(match[4] || "1"),
          lines: [],
        };
      }
    }
    // Hunk content
    else if (currentHunk && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-"))) {
      currentHunk.lines.push(line);
    }
  }

  if (currentHunk && currentFile) currentFile.hunks?.push(currentHunk);
  if (currentFile) result.push(currentFile);

  return result;
}

/** Apply hunks to file content. */
function applyHunks(originalContent: string, hunks: PatchHunk["hunks"]): string {
  const lines = originalContent.split("\n");
  const result: string[] = [];
  let lineIndex = 0;

  for (const hunk of hunks!) {
    // Copy lines before this hunk
    while (lineIndex < hunk.oldStart - 1) {
      result.push(lines[lineIndex++]);
    }

    // Apply hunk
    let hunkLineIndex = 0;
    for (const hunkLine of hunk.lines) {
      if (hunkLine.startsWith(" ")) {
        // Context line - must match
        if (lineIndex >= lines.length || lines[lineIndex] !== hunkLine.slice(1)) {
          throw new Error(`Context mismatch at line ${lineIndex + 1}: expected "${hunkLine.slice(1)}", got "${lines[lineIndex] || "EOF"}"`);
        }
        result.push(lines[lineIndex++]);
        hunkLineIndex++;
      } else if (hunkLine.startsWith("-")) {
        // Delete line - must match
        if (lineIndex >= lines.length || lines[lineIndex] !== hunkLine.slice(1)) {
          throw new Error(`Delete mismatch at line ${lineIndex + 1}: expected "${hunkLine.slice(1)}", got "${lines[lineIndex] || "EOF"}"`);
        }
        lineIndex++;
        hunkLineIndex++;
      } else if (hunkLine.startsWith("+")) {
        // Add line
        result.push(hunkLine.slice(1));
        hunkLineIndex++;
      }
    }
  }

  // Copy remaining lines
  while (lineIndex < lines.length) {
    result.push(lines[lineIndex++]);
  }

  return result.join("\n");
}

export function createWorkspaceTools(rootDir: string, options: WorkspaceToolsOptions = {}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // 1. search_files
  tools.push({
    name: "search_files",
    description: "Search for files and directories by path name within the workspace. Use empty query to list directory contents.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (substring match, case-insensitive). Empty to list all files." },
        path: { type: "string", description: "Directory to search in (relative to workspace root, default: '.')." },
        maxResults: { type: "number", description: `Maximum results to return (default: ${DEFAULT_MAX_RESULTS}).` },
      },
    },
    execute: (args) => {
      const searchPath = args.path ? resolveInsideRoot(rootDir, args.path) : resolve(rootDir);
      const query = String(args.query ?? "").toLowerCase();
      const maxResults = Math.min(Number(args.maxResults) || DEFAULT_MAX_RESULTS, 1000);

      const results: string[] = [];
      for (const { path, isDirectory } of walkFiles(searchPath, rootDir)) {
        if (query && !path.toLowerCase().includes(query)) continue;
        results.push(`${isDirectory ? "[dir]  " : "[file] "}${path}`);
        if (results.length >= maxResults) break;
      }

      return results.length > 0 ? results.join("\n") : "No files found.";
    },
  });

  // 2. grep
  tools.push({
    name: "grep",
    description: "Search for text content within files in the workspace. Returns matching lines with file:line:column:text format.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern (literal string by default, regex if isRegex=true)." },
        path: { type: "string", description: "Directory or file to search in (relative to workspace root, default: '.')." },
        caseSensitive: { type: "boolean", description: "Case-sensitive matching (default: false)." },
        isRegex: { type: "boolean", description: "Treat pattern as regex (default: false)." },
        maxMatches: { type: "number", description: `Maximum matches to return (default: ${DEFAULT_MAX_MATCHES}).` },
      },
      required: ["pattern"],
    },
    execute: (args) => {
      const searchPath = args.path ? resolveInsideRoot(rootDir, args.path) : resolve(rootDir);
      const pattern = String(args.pattern ?? "");
      const caseSensitive = Boolean(args.caseSensitive);
      const isRegex = Boolean(args.isRegex);
      const maxMatches = Math.min(Number(args.maxMatches) || DEFAULT_MAX_MATCHES, 1000);

      let matcher: (line: string) => { index: number; length: number } | null;
      if (isRegex) {
        const regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
        matcher = (line) => {
          const match = regex.exec(line);
          return match ? { index: match.index, length: match[0].length } : null;
        };
      } else {
        const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();
        matcher = (line) => {
          const searchLine = caseSensitive ? line : line.toLowerCase();
          const index = searchLine.indexOf(searchPattern);
          return index >= 0 ? { index, length: pattern.length } : null;
        };
      }

      const results: string[] = [];
      const isFile = existsSync(searchPath) && statSync(searchPath).isFile();
      const filesToSearch = isFile ? [{ path: relative(rootDir, searchPath), isDirectory: false }] : Array.from(walkFiles(searchPath, rootDir));

      for (const { path, isDirectory } of filesToSearch) {
        if (isDirectory) continue;

        const fullPath = resolve(rootDir, path);
        let content: string;
        try {
          content = readFileSync(fullPath, "utf-8");
        } catch {
          continue; // Skip unreadable files
        }

        const lines = content.split("\n");
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const match = matcher(lines[lineNum]);
          if (match) {
            results.push(`${path}:${lineNum + 1}:${match.index + 1}:${lines[lineNum]}`);
            if (results.length >= maxMatches) return results.join("\n");
          }
        }
      }

      return results.length > 0 ? results.join("\n") : "No matches found.";
    },
  });

  // 3. read_file_range
  tools.push({
    name: "read_file_range",
    description: "Read a specific range of lines from a text file with line numbers.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root." },
        startLine: { type: "number", description: "Starting line number (1-indexed, default: 1)." },
        lineCount: { type: "number", description: `Number of lines to read (default: ${DEFAULT_LINE_COUNT}, max: ${MAX_LINES}).` },
      },
      required: ["path"],
    },
    execute: (args) => {
      const target = resolveInsideRoot(rootDir, args.path);
      const startLine = Math.max(1, Number(args.startLine) || 1);
      const lineCount = Math.min(Number(args.lineCount) || DEFAULT_LINE_COUNT, MAX_LINES);

      if (!existsSync(target) || !statSync(target).isFile()) {
        throw new Error(`not a file: ${args.path}`);
      }

      const content = readFileSync(target, "utf-8");
      const lines = content.split("\n");

      const startIndex = startLine - 1;
      const endIndex = Math.min(startIndex + lineCount, lines.length);
      const selectedLines = lines.slice(startIndex, endIndex);

      const numbered = selectedLines.map((line, idx) => {
        const lineNum = startIndex + idx + 1;
        return `${lineNum.toString().padStart(4)} | ${line}`;
      });

      return numbered.join("\n");
    },
  });

  // 4. git_status
  tools.push({
    name: "git_status",
    description: "Show git status in short format.",
    parameters: { type: "object", properties: {} },
    execute: () => {
      const result = spawnSync("git", ["status", "--short", "--branch"], {
        cwd: rootDir,
        encoding: "utf-8",
        maxBuffer: MAX_OUTPUT_BYTES,
      });

      if (result.error) {
        throw new Error(`Git command failed: ${result.error.message}`);
      }

      if (result.status !== 0) {
        return `Error: ${result.stderr || "Not a git repository"}`;
      }

      return result.stdout || "No changes.";
    },
  });

  // 5. git_diff
  tools.push({
    name: "git_diff",
    description: "Show git diff. By default shows working directory changes, use staged=true for staged changes.",
    parameters: {
      type: "object",
      properties: {
        staged: { type: "boolean", description: "Show staged changes instead of working directory (default: false)." },
        path: { type: "string", description: "Limit diff to specific file or directory." },
        maxBytes: { type: "number", description: `Maximum output bytes (default: ${MAX_OUTPUT_BYTES}).` },
      },
    },
    execute: (args) => {
      const gitArgs = ["diff"];
      if (args.staged) gitArgs.push("--cached");
      if (args.path) {
        const target = resolveInsideRoot(rootDir, args.path);
        gitArgs.push("--", relative(rootDir, target));
      }

      const maxBytes = Number(args.maxBytes) || MAX_OUTPUT_BYTES;
      const result = spawnSync("git", gitArgs, {
        cwd: rootDir,
        encoding: "utf-8",
        maxBuffer: Math.max(maxBytes, MAX_OUTPUT_BYTES),
      });

      if (result.error) {
        throw new Error(`Git command failed: ${result.error.message}`);
      }

      if (result.status !== 0) {
        return `Error: ${result.stderr || "Git diff failed"}`;
      }

      return clampOutput(result.stdout || "No changes.", maxBytes);
    },
  });

  // 6. git_show
  tools.push({
    name: "git_show",
    description: "Show git commit details with diff.",
    parameters: {
      type: "object",
      properties: {
        revision: { type: "string", description: "Commit hash, branch name, or revision (e.g., HEAD, HEAD~1)." },
        path: { type: "string", description: "Limit to specific file or directory." },
        maxBytes: { type: "number", description: `Maximum output bytes (default: ${MAX_OUTPUT_BYTES}).` },
      },
      required: ["revision"],
    },
    execute: (args) => {
      const gitArgs = ["show", "--stat", "--patch", String(args.revision)];
      if (args.path) {
        const target = resolveInsideRoot(rootDir, args.path);
        gitArgs.push("--", relative(rootDir, target));
      }

      const maxBytes = Number(args.maxBytes) || MAX_OUTPUT_BYTES;
      const result = spawnSync("git", gitArgs, {
        cwd: rootDir,
        encoding: "utf-8",
        maxBuffer: Math.max(maxBytes, MAX_OUTPUT_BYTES),
      });

      if (result.error) {
        throw new Error(`Git command failed: ${result.error.message}`);
      }

      if (result.status !== 0) {
        return `Error: ${result.stderr || "Revision not found"}`;
      }

      return clampOutput(result.stdout, maxBytes);
    },
  });

  // 7. apply_patch
  tools.push({
    name: "apply_patch",
    mutating: true,
    description: "Apply a unified diff patch to create, modify, or delete files. All changes are applied atomically after approval.",
    parameters: {
      type: "object",
      properties: {
        patch: { type: "string", description: "Unified diff patch content." },
      },
      required: ["patch"],
    },
    execute: async (args) => {
      const patch = String(args.patch ?? "");
      if (!patch.trim()) throw new Error("patch is required");

      // Phase 1: Parse and validate
      const hunks = parsePatch(patch);
      if (hunks.length === 0) throw new Error("No valid patch hunks found");

      // Validate all paths and compute target content
      for (const hunk of hunks) {
        const target = resolveInsideRoot(rootDir, hunk.file);

        if (hunk.operation === "create") {
          if (existsSync(target)) {
            throw new Error(`Cannot create ${hunk.file}: file already exists`);
          }
          // Extract content from + lines
          const lines: string[] = [];
          for (const h of hunk.hunks || []) {
            for (const line of h.lines) {
              if (line.startsWith("+")) lines.push(line.slice(1));
            }
          }
          hunk.newContent = lines.join("\n");
        } else if (hunk.operation === "modify") {
          if (!existsSync(target) || !statSync(target).isFile()) {
            throw new Error(`Cannot modify ${hunk.file}: file does not exist`);
          }
          const original = readFileSync(target, "utf-8");
          hunk.newContent = applyHunks(original, hunk.hunks);
        } else if (hunk.operation === "delete") {
          if (!existsSync(target)) {
            throw new Error(`Cannot delete ${hunk.file}: file does not exist`);
          }
        }
      }

      // Phase 2: Request approval
      const details = hunks.map((h) => `${h.operation} ${h.file}`).join("\n");
      if (options.requireApproval) {
        const approved = await options.requireApproval({ tool: "apply_patch", details });
        if (!approved) {
          return `Refused: patch was not approved by the user.\n${details}`;
        }
      }

      // Phase 3: Apply atomically
      const applied: string[] = [];
      for (const hunk of hunks) {
        const target = resolveInsideRoot(rootDir, hunk.file);

        if (hunk.operation === "create" || hunk.operation === "modify") {
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, hunk.newContent!, "utf-8");
          applied.push(`${hunk.operation} ${hunk.file}`);
        } else if (hunk.operation === "delete") {
          unlinkSync(target);
          applied.push(`delete ${hunk.file}`);
        }
      }

      return `Patch applied successfully:\n${applied.join("\n")}`;
    },
  });

  // 8. delete_file
  tools.push({
    name: "delete_file",
    mutating: true,
    description: "Delete a file (not directories). Requires approval.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root." },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const target = resolveInsideRoot(rootDir, args.path);
      const relPath = getRelativePath(rootDir, target);

      if (!existsSync(target)) {
        throw new Error(`File does not exist: ${relPath}`);
      }

      const stat = statSync(target);
      if (!stat.isFile()) {
        throw new Error(`Not a file: ${relPath}`);
      }

      if (options.requireApproval) {
        const approved = await options.requireApproval({ tool: "delete_file", details: relPath });
        if (!approved) {
          return `Refused: delete ${relPath} was not approved by the user.`;
        }
      }

      unlinkSync(target);
      return `Deleted ${relPath}`;
    },
  });

  // 9. move_file
  tools.push({
    name: "move_file",
    mutating: true,
    description: "Move or rename a file or directory. Requires approval.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source path relative to workspace root." },
        to: { type: "string", description: "Destination path relative to workspace root." },
      },
      required: ["from", "to"],
    },
    execute: async (args) => {
      const fromPath = resolveInsideRoot(rootDir, args.from);
      const toPath = resolveInsideRoot(rootDir, args.to);
      const fromRel = getRelativePath(rootDir, fromPath);
      const toRel = getRelativePath(rootDir, toPath);

      if (!existsSync(fromPath)) {
        throw new Error(`Source does not exist: ${fromRel}`);
      }

      if (existsSync(toPath)) {
        throw new Error(`Destination already exists: ${toRel}`);
      }

      if (options.requireApproval) {
        const approved = await options.requireApproval({ tool: "move_file", details: `${fromRel} → ${toRel}` });
        if (!approved) {
          return `Refused: move ${fromRel} → ${toRel} was not approved by the user.`;
        }
      }

      mkdirSync(dirname(toPath), { recursive: true });
      renameSync(fromPath, toPath);
      return `Moved ${fromRel} → ${toRel}`;
    },
  });

  // 10. mkdir
  tools.push({
    name: "mkdir",
    mutating: true,
    description: "Create a directory (recursive). Requires approval.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to workspace root." },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const target = resolveInsideRoot(rootDir, args.path);
      const relPath = getRelativePath(rootDir, target);

      if (options.requireApproval) {
        const approved = await options.requireApproval({ tool: "mkdir", details: relPath });
        if (!approved) {
          return `Refused: create directory ${relPath} was not approved by the user.`;
        }
      }

      mkdirSync(target, { recursive: true });
      return `Created directory ${relPath}`;
    },
  });

  // 11. read_file
  tools.push({
    name: "read_file",
    description: "Read complete file content (UTF-8, max 256KB). Use read_file_range for large files or partial reading.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root." },
      },
      required: ["path"],
    },
    execute: (args) => {
      const target = resolveInsideRoot(rootDir, args.path);

      if (!existsSync(target) || !statSync(target).isFile()) {
        throw new Error(`not a file: ${args.path}`);
      }

      const stat = statSync(target);
      if (stat.size > MAX_OUTPUT_BYTES) {
        throw new Error(`file too large (${stat.size} bytes, limit ${MAX_OUTPUT_BYTES}). Use read_file_range instead.`);
      }

      return readFileSync(target, "utf-8");
    },
  });

  // 11b. list_files (ls)：列出目录内容，区分文件/目录，可选递归。
  tools.push({
    name: "list_files",
    description:
      "List the contents of a directory (like `ls`). Returns each entry marked as a file or directory. " +
      "Use this to explore the workspace structure before reading or editing. " +
      "Ignores noise dirs (.git, node_modules, dist, build, .cache, coverage).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Directory path relative to workspace root. Defaults to the workspace root when omitted.",
        },
        recursive: {
          type: "boolean",
          description:
            "When true, walk subdirectories recursively (depth-limited). Defaults to false (single level).",
        },
      },
    },
    execute: (args) => {
      const rel = String(args.path ?? "").trim();
      const target = rel ? resolveInsideRoot(rootDir, rel) : resolve(rootDir);
      if (!existsSync(target) || !statSync(target).isDirectory()) {
        throw new Error(`not a directory: ${rel || "."}`);
      }

      const recursive = args.recursive === true;
      const MAX_ENTRIES = 1000;
      const MAX_DEPTH = 8;
      const lines: string[] = [];
      let count = 0;
      let truncated = false;

      const walk = (dir: string, depth: number): void => {
        if (truncated) return;
        let entries: Dirent[];
        try {
          entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
        } catch {
          return;
        }
        // 目录在前、再按名字排序，输出稳定可读。
        const sorted = [...entries].sort((a, b) => {
          const ad = a.isDirectory() ? 0 : 1;
          const bd = b.isDirectory() ? 0 : 1;
          return ad !== bd ? ad - bd : a.name.localeCompare(b.name);
        });
        for (const entry of sorted) {
          if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
          if (count >= MAX_ENTRIES) {
            truncated = true;
            return;
          }
          const abs = join(dir, entry.name);
          const display = getRelativePath(rootDir, abs);
          lines.push(entry.isDirectory() ? `${display}/` : display);
          count += 1;
          if (recursive && entry.isDirectory() && depth < MAX_DEPTH) {
            walk(abs, depth + 1);
          }
        }
      };

      walk(target, 0);
      if (lines.length === 0) return "(empty directory)";
      const header = truncated
        ? `(truncated at ${MAX_ENTRIES} entries)\n`
        : "";
      return `${header}${lines.join("\n")}`;
    },
  });

  // 12. write_file
  tools.push({
    name: "write_file",
    mutating: true,
    description: "Create or overwrite a file with complete content. Requires approval.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root." },
        content: { type: "string", description: "Complete file content to write." },
      },
      required: ["path", "content"],
    },
    execute: async (args) => {
      const target = resolveInsideRoot(rootDir, args.path);
      const newContent = String(args.content ?? "");
      const relPath = getRelativePath(rootDir, target);

      // Compute diff for approval preview
      let diff = "";
      if (existsSync(target)) {
        const originalContent = readFileSync(target, "utf-8");
        diff = computeDiff(originalContent, newContent, relPath);
      } else {
        // For new files, show as all additions
        const lines = newContent.split("\n");
        diff = lines.slice(0, 50).map(line => `+ ${line}`).join("\n");
        if (lines.length > 50) {
          diff += `\n... (${lines.length - 50} more lines)`;
        }
      }

      if (options.requireApproval) {
        const preview = diff.length > MAX_PREVIEW_CHARS
          ? diff.slice(0, MAX_PREVIEW_CHARS) + `\n... (${diff.length - MAX_PREVIEW_CHARS} more chars)`
          : diff;

        const approved = await options.requireApproval({
          tool: "write_file",
          details: `${relPath}\n\n${preview}`
        });
        if (!approved) {
          return `Refused: write to ${relPath} was not approved by the user.`;
        }
      }

      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, newContent, "utf-8");
      return `wrote ${newContent.length} characters to ${relPath}`;
    },
  });

  // 13. edit_file
  tools.push({
    name: "edit_file",
    mutating: true,
    description: "Replace exact substring in file (must match exactly once). Requires approval. Use for simple targeted edits.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root." },
        oldString: { type: "string", description: "Exact text to find. Must match exactly once." },
        newString: { type: "string", description: "Text to replace it with." },
      },
      required: ["path", "oldString", "newString"],
    },
    execute: async (args) => {
      const target = resolveInsideRoot(rootDir, args.path);
      const oldString = String(args.oldString ?? "");
      const newString = String(args.newString ?? "");

      if (!oldString) throw new Error("oldString is required and must be non-empty");

      if (!existsSync(target) || !statSync(target).isFile()) {
        throw new Error(`not a file: ${args.path}`);
      }

      const original = readFileSync(target, "utf-8");

      // Find match - must be unique
      const firstIndex = original.indexOf(oldString);
      if (firstIndex < 0) {
        throw new Error(`oldString not found in ${args.path}. Read the file and copy the exact text.`);
      }
      if (original.indexOf(oldString, firstIndex + oldString.length) >= 0) {
        const count = original.split(oldString).length - 1;
        throw new Error(`oldString matches ${count} times in ${args.path}; it must be unique. Add more surrounding context.`);
      }

      const relPath = getRelativePath(rootDir, target);

      // Compute diff for approval preview
      const updated = original.slice(0, firstIndex) + newString + original.slice(firstIndex + oldString.length);
      const diff = computeDiff(original, updated, relPath);

      if (options.requireApproval) {
        const preview = diff.length > MAX_PREVIEW_CHARS
          ? diff.slice(0, MAX_PREVIEW_CHARS) + `\n... (${diff.length - MAX_PREVIEW_CHARS} more chars)`
          : diff;

        const approved = await options.requireApproval({
          tool: "edit_file",
          details: `${relPath}\n\n${preview}`
        });
        if (!approved) {
          return `Refused: edit to ${relPath} was not approved by the user.`;
        }
      }

      writeFileSync(target, updated, "utf-8");
      return `edited ${relPath} (replaced ${oldString.length} chars with ${newString.length} chars)`;
    },
  });

  // 14. web_search
  tools.push({
    name: "web_search",
    description: "Search the web for information using DuckDuckGo. Returns search results with titles, snippets, and URLs.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        maxResults: { type: "number", description: "Maximum results to return (default: 10)." },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = String(args.query ?? "");
      const maxResults = Number(args.maxResults ?? 10);

      try {
        const results = await duckDuckGoSearch(query, maxResults);

        if (results.length === 0) {
          return `No results found for "${query}". Try a different query or use run_command curl for manual search.`;
        }

        let output = `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${query}":\n\n`;
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          output += `${i + 1}. **${r.title}**\n`;
          output += `   [${r.url}](${r.url})\n`; // Markdown link format for clickability
          if (r.snippet) {
            const preview = r.snippet.length > 150 ? r.snippet.slice(0, 150) + "..." : r.snippet;
            output += `   ${preview}\n`;
          }
          output += `\n`;
        }
        return output;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return `Web search failed: ${msg}\n\nFallback: use run_command curl "https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json"`;
      }
    },
  });

  // 15. web_fetch
  tools.push({
    name: "web_fetch",
    description: "Fetch content from a URL. Returns page content (HTML or extracted text). Supports http:// and https://.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch (must start with http:// or https://)." },
        maxBytes: { type: "number", description: "Maximum response size in bytes (default: 256KB)." },
        extractContent: {
          type: "boolean",
          description: "Extract main content from HTML, removing scripts/styles/navigation (default: true). Set to false for raw HTML.",
        },
        summarize: {
          type: "boolean",
          description: "Generate extractive summary for long content (default: false). Shows 3-5 key sentences before full content.",
        },
      },
      required: ["url"],
    },
    execute: async (args) => {
      const url = String(args.url ?? "");
      const maxBytes = Number(args.maxBytes ?? MAX_OUTPUT_BYTES);
      const extractContent = args.extractContent !== false; // Default true
      const summarize = Boolean(args.summarize); // Default false

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        throw new Error("URL must start with http:// or https://");
      }

      try {
        const data = await new Promise<string>((resolve, reject) => {
          const protocol = url.startsWith("https") ? https : http;
          const req = protocol.get(url, { timeout: 30000 }, (res) => {
            let data = "";
            res.on("data", (chunk) => {
              data += chunk;
              if (data.length > maxBytes) {
                req.destroy();
                resolve(clampOutput(data, maxBytes));
              }
            });
            res.on("end", () => resolve(data));
          });
          req.on("error", reject);
          req.on("timeout", () => {
            req.destroy();
            reject(new Error("Request timeout after 30s"));
          });
        });

        let content = data;

        // Extract main content if it looks like HTML
        if (extractContent && (data.includes("<!DOCTYPE") || data.includes("<html") || data.includes("<body"))) {
          content = extractMainContent(data);
        }

        // Generate summary if requested and content is long
        if (summarize && content.length > 2000) {
          const summary = extractiveSummary(content, 5);
          if (summary) {
            return `**Summary:**\n${summary}\n\n**Full Content:**\n${content}`;
          }
        }

        return content;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return `Failed to fetch ${url}: ${msg}\n\nFallback: use run_command curl "${url}"`;
      }
    },
  });

  return tools;
}

