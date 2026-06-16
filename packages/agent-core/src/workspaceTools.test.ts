import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceTools } from "./workspaceTools";
import type { ToolDefinition } from "./types";

function byName(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

describe("createWorkspaceTools › list_files", () => {
  let root: string;
  let list: ToolDefinition;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "agent-core-ls-"));
    list = byName(createWorkspaceTools(root), "list_files");
    await writeFile(join(root, "b.txt"), "b", "utf8");
    await writeFile(join(root, "a.txt"), "a", "utf8");
    await mkdir(join(root, "sub"), { recursive: true });
    await writeFile(join(root, "sub", "c.txt"), "c", "utf8");
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "x", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists a single level with directories first, marked with a trailing slash", async () => {
    const out = String(await list.execute({}));
    const lines = out.split("\n");
    // 目录在前（带尾斜杠），文件按名排序在后。
    expect(lines).toEqual([
      `${join(".", "sub")}/`,
      join(".", "a.txt"),
      join(".", "b.txt"),
    ]);
  });

  it("ignores noise dirs like node_modules", async () => {
    const out = String(await list.execute({ recursive: true }));
    expect(out).not.toContain("node_modules");
    expect(out).not.toContain("index.js");
  });

  it("recurses into subdirectories when recursive=true", async () => {
    const out = String(await list.execute({ recursive: true }));
    expect(out).toContain("c.txt");
  });

  it("does not recurse by default", async () => {
    const out = String(await list.execute({}));
    expect(out).not.toContain("c.txt");
  });

  it("rejects a path that escapes the sandbox root", async () => {
    expect(() => list.execute({ path: "../.." })).toThrow(/escapes sandbox/i);
  });

  it("errors when the target is not a directory", async () => {
    expect(() => list.execute({ path: "a.txt" })).toThrow(/not a directory/i);
  });
});
