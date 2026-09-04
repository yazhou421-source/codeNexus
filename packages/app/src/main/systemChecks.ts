import { spawnSync } from "node:child_process";
import { app } from "electron";
import type { CodexDiagnosticsResult } from "@codenexus/shared/ipc/contracts";
import { resolveCurrentCodexExecutable, type CodexExecutableSource } from "./codexExecutableResolver";
import { logger } from "./utils/logger";

type ToolDiagnostic = { ok: boolean; required?: boolean; details?: string };

function detectPathTool(name: string): ToolDiagnostic {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const res = spawnSync(locator, [name], { encoding: "utf8" });
  if (res.status === 0) return { ok: true, required: true, details: String(res.stdout ?? "").trim() };
  return { ok: false, required: true, details: String(res.stderr || res.stdout || "").trim() };
}

export async function detectCodexNative(): Promise<{
  ok: boolean;
  details?: string;
  source?: CodexExecutableSource;
  version?: string;
}> {
  try {
    const resolution = await resolveCurrentCodexExecutable();
    return {
      ok: true,
      source: resolution.source,
      version: resolution.version,
      details: `${resolution.version} (${resolution.source})\n${resolution.path}`,
    };
  } catch (error) {
    logger.error("codex-runtime", "runtime diagnostics failed", error);
    return { ok: false, details: error instanceof Error ? error.message : String(error) };
  }
}

export function detectNpmNative(): ToolDiagnostic {
  return detectPathTool("npm");
}

export function detectNodeNative(): ToolDiagnostic {
  return detectPathTool("node");
}

export async function getCodexDiagnostics(): Promise<CodexDiagnosticsResult> {
  const codex = await detectCodexNative();
  const selfContained = app.isPackaged;
  const notRequired = { ok: true, required: false } as const;
  return {
    selfContained,
    codex,
    node: selfContained ? notRequired : detectNodeNative(),
    npm: selfContained ? notRequired : detectNpmNative(),
  };
}
