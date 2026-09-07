import { ipcMain } from "electron";
import { execFile } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { IPC_WORKSPACE_CHANNELS } from "@codenexus/shared/ipc/channels";
import type {
  WorkspaceGitStatusCode,
  WorkspaceGitStatusEntry,
  WorkspaceGitStatusResult,
} from "@codenexus/shared/ipc/contracts";
import { WorkspacePatchService } from "../../services/WorkspacePatchService";
import type { WorkspaceAccessService } from "../../services/WorkspaceAccessService";

const execFileAsync = promisify(execFile);

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "unknown error");
}

function normalizeGitPath(root: string, relativePath: string): string {
  const parts = String(relativePath ?? "")
    .split("/")
    .filter(Boolean);
  return resolve(root, ...parts);
}

function statusCodeFromPorcelain(raw: string): WorkspaceGitStatusCode {
  const status = String(raw ?? "");
  if (status === "??") return "?";
  if (status.includes("U")) return "U";
  if (status.includes("A")) return "A";
  if (status.includes("D")) return "D";
  if (status.includes("R")) return "R";
  if (status.includes("C")) return "C";
  return "M";
}

function parsePorcelainStatus(root: string, output: string): WorkspaceGitStatusEntry[] {
  const tokens = String(output ?? "")
    .split("\0")
    .filter(Boolean);
  const entries: WorkspaceGitStatusEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token.length < 4) continue;
    const raw = token.slice(0, 2);
    const relativePath = token.slice(3);
    if (!relativePath) continue;
    if (raw.includes("R") || raw.includes("C")) index += 1;
    entries.push({
      path: normalizeGitPath(root, relativePath),
      relativePath,
      code: statusCodeFromPorcelain(raw),
      raw,
    });
  }
  return entries;
}

async function readWorkspaceGitStatus(cwd: string): Promise<WorkspaceGitStatusResult> {
  let workspace = String(cwd ?? "").trim();
  if (!isAbsolute(workspace))
    return { ok: false, root: "", entries: [], reason: "failed", message: "Invalid workspace" };
  let root = workspace;
  try {
    workspace = await realpath(workspace);
    const rootResult = await execFileAsync("git", ["-C", workspace, "rev-parse", "--show-toplevel"], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 3000,
    });
    root = resolve(String(rootResult.stdout ?? "").trim());
  } catch (error) {
    return {
      ok: false,
      root,
      entries: [],
      reason: "not_git",
      message: readErrorMessage(error),
    };
  }

  try {
    const statusResult = await execFileAsync(
      "git",
      [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-C",
        workspace,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--no-renames",
        "--",
        ".",
        ...["node_modules", ".git", "dist", "release", ".cache"].map((dir) => `:(glob,exclude)**/${dir}/**`),
      ],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        timeout: 3000,
      }
    );
    return {
      ok: true,
      root,
      entries: parsePorcelainStatus(root, String(statusResult.stdout ?? "")).filter((entry) => {
        const path = relative(workspace, entry.path);
        return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
      }),
    };
  } catch (error) {
    return {
      ok: false,
      root,
      entries: [],
      reason: "failed",
      message: readErrorMessage(error),
    };
  }
}

export function registerWorkspaceHandlers(deps: {
  workspacePatchService: WorkspacePatchService;
  workspaceAccess: WorkspaceAccessService;
}) {
  const { workspacePatchService, workspaceAccess } = deps;
  ipcMain.handle(IPC_WORKSPACE_CHANNELS.workspaceActivate, async (evt, args: { cwd: string }) => {
    return { ok: await workspaceAccess.activate(evt, args?.cwd) };
  });
  ipcMain.handle(IPC_WORKSPACE_CHANNELS.workspaceGitDiffRead, async (evt, args: { cwd: string }) => {
    const lease = await workspaceAccess.workspace(evt, args?.cwd);
    const result = await workspacePatchService.readGitDiff({ cwd: lease.root });
    lease.assertCurrent();
    return result;
  });

  ipcMain.handle(
    IPC_WORKSPACE_CHANNELS.workspaceReverseDiffDryRun,
    async (_evt, args: { cwd: string; diffText: string }) => {
      // 仅校验补丁是否可逆应用，不修改文件。
      return await workspacePatchService.dryRunApplyReverseDiff(args);
    }
  );

  ipcMain.handle(
    IPC_WORKSPACE_CHANNELS.workspaceReverseDiffApply,
    async (_evt, args: { cwd: string; diffText: string }) => {
      // 正式执行反向补丁，回退工作区文件内容。
      return await workspacePatchService.applyReverseDiff(args);
    }
  );

  ipcMain.handle(IPC_WORKSPACE_CHANNELS.workspaceGitStatusRead, async (evt, args: { cwd: string }) => {
    const lease = await workspaceAccess.workspace(evt, args?.cwd);
    const result = await readWorkspaceGitStatus(lease.root);
    lease.assertCurrent();
    return result;
  });
}
