import { codexDesktop } from "../../api/codexDesktopClient";
import { translate } from "../../i18n/translate";
import { isIpcHandlerMissingError } from "../../shared/ipcErrors";
import type {
  WorkspaceDirectoryReadResult,
  WorkspaceFileMetadataState,
  WorkspaceTextFileReadResult,
  WorkspaceTextFileWriteResult,
} from "../types";
import { isWithinWorkspaceFsPath, resolveWorkspaceFsPath } from "../workspacePath";
import { IPC_APP_CHANNELS } from "@codenexus/shared/ipc";
import type { AppTextEncoding, AppTextLineEnding } from "@codenexus/shared/ipc/contracts";

type WorkspacePathResolution = {
  workspace: string;
  path: string;
};

export type WorkspacePathResolver = (inputPath: string) => WorkspacePathResolution;

export type WorkspacePathResolverDeps = {
  getWorkspacePath: () => string;
  normalizeWorkspacePath: (value: string) => string;
};

export function createWorkspacePathResolver(deps: WorkspacePathResolverDeps): WorkspacePathResolver {
  return (inputPath: string) => {
    const workspace = deps.normalizeWorkspacePath(deps.getWorkspacePath());
    if (!workspace) throw new Error(translate("runtime.workspaceRequired"));
    const path = resolveWorkspaceFsPath(workspace, inputPath);
    if (!path) throw new Error(translate("runtime.invalidFilePath"));
    if (!isWithinWorkspaceFsPath(workspace, path)) {
      throw new Error(translate("runtime.fileOutsideWorkspace"));
    }
    return { workspace, path };
  };
}

export type WorkspaceFileRuntime = {
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  readWorkspaceDirectory: (path?: string) => Promise<WorkspaceDirectoryReadResult>;
  getWorkspaceMetadata: (path: string) => Promise<WorkspaceFileMetadataState>;
  readWorkspaceTextFile: (path: string) => Promise<WorkspaceTextFileReadResult>;
  deleteWorkspaceFile: (path: string) => Promise<void>;
  writeWorkspaceTextFile: (
    path: string,
    content: string,
    options?: { encoding?: AppTextEncoding; lineEnding?: AppTextLineEnding }
  ) => Promise<WorkspaceTextFileWriteResult>;
};

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "unknown error");
}

function normalizeEditorTextContent(content: string): string {
  return String(content ?? "").replace(/\r\n?/g, "\n");
}

function normalizeWriteLineEnding(content: string, lineEnding: AppTextLineEnding): string {
  if (lineEnding === "CRLF") return String(content ?? "").replace(/\r?\n/g, "\r\n");
  if (lineEnding === "CR") return String(content ?? "").replace(/\r?\n/g, "\r");
  return String(content ?? "").replace(/\r\n?/g, "\n");
}

async function readTextFileViaLocalIpc(path: string): Promise<string> {
  const filePath = String(path ?? "").trim();
  if (!filePath) return "";
  try {
    const res = await codexDesktop.app.readTextFile({ path: filePath });
    return String(res?.content ?? "");
  } catch (error) {
    const msg = readErrorMessage(error);
    if (isIpcHandlerMissingError(msg, IPC_APP_CHANNELS.appReadTextFile)) {
      throw new Error(translate("runtime.mainFileReadCapabilityMissing"));
    }
    throw error;
  }
}

async function readTextFileDetailViaLocalIpc(
  path: string
): Promise<{ content: string; encoding: AppTextEncoding; lineEnding: AppTextLineEnding }> {
  const filePath = String(path ?? "").trim();
  if (!filePath) {
    return { content: "", encoding: "UTF-8", lineEnding: "LF" };
  }
  try {
    const res = await codexDesktop.app.readTextFile({ path: filePath });
    return {
      content: normalizeEditorTextContent(String(res?.content ?? "")),
      encoding: res?.encoding === "UTF-8 BOM" ? "UTF-8 BOM" : "UTF-8",
      lineEnding: res?.lineEnding === "CRLF" || res?.lineEnding === "CR" ? res.lineEnding : "LF",
    };
  } catch (error) {
    const msg = readErrorMessage(error);
    if (isIpcHandlerMissingError(msg, IPC_APP_CHANNELS.appReadTextFile)) {
      throw new Error(translate("runtime.mainFileReadCapabilityMissing"));
    }
    throw error;
  }
}

async function writeTextFileViaLocalIpc(path: string, content: string): Promise<void> {
  const filePath = String(path ?? "").trim();
  if (!filePath) throw new Error("missing file path");
  try {
    await codexDesktop.app.writeTextFile({ path: filePath, content: String(content ?? "") });
  } catch (error) {
    const msg = readErrorMessage(error);
    if (isIpcHandlerMissingError(msg, IPC_APP_CHANNELS.appWriteTextFile)) {
      throw new Error(translate("runtime.mainFileWriteCapabilityMissing"));
    }
    throw error;
  }
}

async function readDirectoryViaLocalIpc(path: string, workspaceRoot: string): Promise<WorkspaceDirectoryReadResult> {
  const dirPath = String(path ?? "").trim();
  if (!dirPath) throw new Error("missing directory path");
  try {
    const res = await codexDesktop.app.readDirectory({ path: dirPath, workspaceRoot });
    const entries = (Array.isArray(res?.entries) ? res.entries : [])
      .map((entry) => ({
        path: resolveWorkspaceFsPath(dirPath, String(entry.fileName ?? "")),
        fileName: String(entry.fileName ?? "").trim(),
        isDirectory: Boolean(entry.isDirectory),
        isFile: Boolean(entry.isFile),
        source: "local" as const,
      }))
      .filter((entry) => Boolean(entry.fileName))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.fileName.localeCompare(b.fileName, "zh-CN");
      });
    return {
      path: dirPath,
      entries,
      source: "local",
    };
  } catch (error) {
    const msg = readErrorMessage(error);
    if (isIpcHandlerMissingError(msg, IPC_APP_CHANNELS.appReadDirectory)) {
      throw new Error(translate("runtime.mainDirectoryReadCapabilityMissing"));
    }
    throw error;
  }
}

async function getMetadataViaLocalIpc(path: string): Promise<WorkspaceFileMetadataState> {
  const filePath = String(path ?? "").trim();
  if (!filePath) throw new Error("missing file path");
  try {
    const res = await codexDesktop.app.getFileMetadata({ path: filePath });
    return {
      path: filePath,
      isDirectory: Boolean(res?.metadata?.isDirectory),
      isFile: Boolean(res?.metadata?.isFile),
      createdAtMs: Number.isFinite(res?.metadata?.createdAtMs) ? Number(res.metadata.createdAtMs) : 0,
      modifiedAtMs: Number.isFinite(res?.metadata?.modifiedAtMs) ? Number(res.metadata.modifiedAtMs) : 0,
      source: "local",
    };
  } catch (error) {
    const msg = readErrorMessage(error);
    if (isIpcHandlerMissingError(msg, IPC_APP_CHANNELS.appGetFileMetadata)) {
      throw new Error(translate("runtime.mainFileMetadataCapabilityMissing"));
    }
    throw error;
  }
}

async function deleteFileViaLocalIpc(path: string): Promise<void> {
  const filePath = String(path ?? "").trim();
  if (!filePath) throw new Error("missing file path");
  try {
    await codexDesktop.app.deleteFile({ path: filePath });
  } catch (error) {
    const msg = readErrorMessage(error);
    if (isIpcHandlerMissingError(msg, IPC_APP_CHANNELS.appDeleteFile)) {
      throw new Error(translate("runtime.mainFileDeleteCapabilityMissing"));
    }
    throw error;
  }
}

export function createWorkspaceFileRuntime(resolveWorkspacePath: WorkspacePathResolver): WorkspaceFileRuntime {
  const readWorkspaceDirectory = async (path = ""): Promise<WorkspaceDirectoryReadResult> => {
    const resolved = resolveWorkspacePath(path);
    return await readDirectoryViaLocalIpc(resolved.path, resolved.workspace);
  };

  const getWorkspaceMetadata = async (path: string): Promise<WorkspaceFileMetadataState> => {
    const resolved = resolveWorkspacePath(path);
    return await getMetadataViaLocalIpc(resolved.path);
  };

  const readWorkspaceTextFile = async (path: string): Promise<WorkspaceTextFileReadResult> => {
    const resolved = resolveWorkspacePath(path);
    const readResult = await readTextFileDetailViaLocalIpc(resolved.path);
    return {
      path: resolved.path,
      content: readResult.content,
      source: "local",
      encoding: readResult.encoding,
      lineEnding: readResult.lineEnding,
    };
  };

  const writeWorkspaceTextFile = async (
    path: string,
    content: string,
    options?: { encoding?: AppTextEncoding; lineEnding?: AppTextLineEnding }
  ): Promise<WorkspaceTextFileWriteResult> => {
    const resolved = resolveWorkspacePath(path);
    const encoding = options?.encoding === "UTF-8 BOM" ? "UTF-8 BOM" : "UTF-8";
    const lineEnding = options?.lineEnding === "CRLF" || options?.lineEnding === "CR" ? options.lineEnding : "LF";
    await codexDesktop.app.writeTextFile({
      path: resolved.path,
      content: normalizeWriteLineEnding(content, lineEnding),
      encoding,
    });
    return {
      path: resolved.path,
      source: "local",
      encoding,
      lineEnding,
    };
  };

  const deleteWorkspaceFile = async (path: string): Promise<void> => {
    const resolved = resolveWorkspacePath(path);
    await deleteFileViaLocalIpc(resolved.path);
  };

  return {
    readTextFile: readTextFileViaLocalIpc,
    writeTextFile: writeTextFileViaLocalIpc,
    readWorkspaceDirectory,
    getWorkspaceMetadata,
    readWorkspaceTextFile,
    deleteWorkspaceFile,
    writeWorkspaceTextFile,
  };
}
