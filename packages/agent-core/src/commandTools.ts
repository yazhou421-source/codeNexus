import { spawn, type ChildProcess } from "node:child_process";
import type { ToolDefinition } from "./types";

/**
 * Command execution tool (run_command only).
 *
 * Executes one-off shell commands with timeout and dangerous command detection.
 * Process management tools have been removed - use run_command for all shell operations.
 *
 * Security: Commands run in sandbox cwd with dangerous pattern detection.
 */

/** run_command default timeout (milliseconds). */
const DEFAULT_RUN_TIMEOUT_MS = 60_000;

/** One-shot output limit (same as MAX_OUTPUT_BYTES in workspaceTools). */
const MAX_OUTPUT_BYTES = 256 * 1024;

/**
 * Detect obviously dangerous commands as a first line of defense.
 *
 * This is not complete protection - requireConfirmation should be used for user approval.
 * Returns error reason if dangerous, null if allowed.
 */
function detectDangerousCommand(command: string): string | null {
  const normalized = command.toLowerCase();
  const patterns: Array<{ re: RegExp; reason: string }> = [
    {
      re: /\brm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*f|\brm\s+-rf?\b/,
      reason: "recursive force delete (rm -rf)",
    },
    { re: /\bdel\s+\/[sq]/, reason: "recursive/quiet delete (del /s)" },
    { re: /\brmdir\s+\/s\b/, reason: "recursive directory removal (rmdir /s)" },
    { re: /\bformat\b\s+[a-z]:/, reason: "disk format" },
    { re: /\bmkfs\b/, reason: "filesystem creation (mkfs)" },
    {
      re: /\b(shutdown|reboot|halt|poweroff)\b/,
      reason: "system power control",
    },
    { re: /\bdd\s+.*\bof=\/dev\//, reason: "raw disk write (dd of=/dev/...)" },
    { re: />\s*\/dev\/sd[a-z]/, reason: "raw disk overwrite" },
    { re: /:\(\)\s*\{.*\}\s*;\s*:/, reason: "fork bomb" },
  ];
  for (const { re, reason } of patterns) {
    if (re.test(normalized)) return reason;
  }
  return null;
}

export interface CommandToolsOptions {
  /** Sandbox working directory (required). All commands run here. */
  cwd: string;
  /**
   * Optional confirmation hook for user approval before command execution.
   * Returns true to allow, false to reject. If not specified, all commands are allowed.
   */
  requireConfirmation?: (command: string) => Promise<boolean> | boolean;
}

/** Clamp output to last N bytes (keep recent content). */
function clampOutput(text: string): string {
  return text.length > MAX_OUTPUT_BYTES
    ? text.slice(text.length - MAX_OUTPUT_BYTES)
    : text;
}

function abortError(): Error {
  return Object.assign(new Error("Command execution was cancelled."), {
    name: "AbortError",
  });
}

function killProcessTree(proc: ChildProcess): void {
  const pid = proc.pid;
  try {
    if (process.platform === "win32" && pid) {
      const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => undefined);
      killer.unref();
      return;
    }
    proc.kill();
  } catch {
    try {
      proc.kill();
    } catch {
      // Process may already have exited.
    }
  }
}

export function createCommandTools(
  options: CommandToolsOptions,
): ToolDefinition[] {
  const { cwd, requireConfirmation } = options;

  const guard = async (command: string): Promise<string | null> => {
    const danger = detectDangerousCommand(command);
    if (danger)
      return `Refused: command looks dangerous (${danger}). Rephrase or narrow the scope.`;
    if (requireConfirmation) {
      const ok = await requireConfirmation(command);
      if (!ok) return "Refused: command was not confirmed by the user.";
    }
    return null;
  };

  return [
    {
      name: "run_command",
      description:
        "Run a one-shot shell command (e.g. git status, node -v, npm test, pnpm build). " +
        "Waits for completion and returns exit code, stdout and stderr. " +
        "Use this for tests, builds, environment checks, and any command expected to finish.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command line to run.",
          },
          timeoutMs: {
            type: "number",
            description: `Optional timeout in milliseconds (default ${DEFAULT_RUN_TIMEOUT_MS}).`,
          },
        },
        required: ["command"],
      },
      execute: async (args, context) => {
        const command = String(args.command ?? "").trim();
        if (!command) throw new Error("command is required");
        if (context?.signal?.aborted) throw abortError();

        const refused = await guard(command);
        if (refused) return refused;
        if (context?.signal?.aborted) throw abortError();

        const timeoutMs =
          typeof args.timeoutMs === "number" && args.timeoutMs > 0
            ? args.timeoutMs
            : DEFAULT_RUN_TIMEOUT_MS;

        return await new Promise<string>((resolvePromise, rejectPromise) => {
          const proc = spawn(command, { shell: true, cwd, windowsHide: true });
          let stdout = "";
          let stderr = "";
          let timedOut = false;
          let cancelled = false;
          let settled = false;

          const timer = setTimeout(() => {
            timedOut = true;
            killProcessTree(proc);
          }, timeoutMs);

          const cleanup = () => {
            clearTimeout(timer);
            context?.signal?.removeEventListener("abort", onAbort);
          };

          const onAbort = () => {
            if (settled) return;
            cancelled = true;
            killProcessTree(proc);
          };

          if (context?.signal?.aborted) {
            cleanup();
            rejectPromise(abortError());
            return;
          }
          context?.signal?.addEventListener("abort", onAbort, { once: true });

          proc.stdout?.on("data", (buf) => {
            stdout = clampOutput(stdout + buf.toString());
          });
          proc.stderr?.on("data", (buf) => {
            stderr = clampOutput(stderr + buf.toString());
          });
          proc.on("error", (err) => {
            settled = true;
            cleanup();
            if (cancelled) {
              rejectPromise(abortError());
              return;
            }
            resolvePromise(`Failed to spawn command: ${err.message}`);
          });
          proc.on("exit", (code) => {
            settled = true;
            cleanup();
            if (cancelled) {
              rejectPromise(abortError());
              return;
            }
            const parts = [
              `exitCode: ${timedOut ? "killed (timeout)" : (code ?? "null")}`,
              `stdout:\n${stdout || "(empty)"}`,
              `stderr:\n${stderr || "(empty)"}`,
            ];
            resolvePromise(parts.join("\n\n"));
          });
        });
      },
    },
  ];
}
