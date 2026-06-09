import { describe, it, expect } from "vitest";
import { createCommandTools } from "./commandTools";
import type { ToolDefinition } from "./types";

/**
 * commandTools integration tests using real spawn.
 * Tests run_command with actual node execution to verify exitCode/stdout,
 * dangerous command rejection, and confirmation hooks.
 */

/** Helper to find a tool by name. */
function byName(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

describe("createCommandTools", () => {
  it("run_command runs a one-shot command and reports exit code + stdout", async () => {
    const tools = createCommandTools({ cwd: process.cwd() });

    const out = await byName(tools, "run_command").execute({
      command: 'node -e "console.log(42)"',
    });

    expect(out).toContain("exitCode: 0");
    expect(out).toContain("42");
  });

  it("run_command surfaces a non-zero exit code", async () => {
    const tools = createCommandTools({ cwd: process.cwd() });

    const out = await byName(tools, "run_command").execute({
      command: 'node -e "process.exit(3)"',
    });

    expect(out).toContain("exitCode: 3");
  });

  it("run_command kills a command that exceeds the timeout", async () => {
    const tools = createCommandTools({ cwd: process.cwd() });

    const out = await byName(tools, "run_command").execute({
      command: 'node -e "setTimeout(() => {}, 2000)"',
      timeoutMs: 200,
    });

    expect(out).toContain("killed (timeout)");
  });

  it("run_command stops the child process when the tool context is aborted", async () => {
    const tools = createCommandTools({ cwd: process.cwd() });
    const controller = new AbortController();
    const promise = byName(tools, "run_command").execute(
      {
        command: 'node -e "setTimeout(() => {}, 10000)"',
        timeoutMs: 10000,
      },
      { signal: controller.signal },
    );

    setTimeout(() => controller.abort(), 50);

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("refuses obviously dangerous commands without spawning them", async () => {
    const tools = createCommandTools({ cwd: process.cwd() });

    const rm = await byName(tools, "run_command").execute({
      command: "rm -rf /",
    });
    expect(rm).toContain("Refused");
    expect(rm).toContain("dangerous");
  });

  it("respects a requireConfirmation hook that denies the command", async () => {
    const tools = createCommandTools({
      cwd: process.cwd(),
      requireConfirmation: () => false,
    });

    const out = await byName(tools, "run_command").execute({
      command: "node -v",
    });

    expect(out).toContain("Refused");
    expect(out).toContain("not confirmed");
  });
});
