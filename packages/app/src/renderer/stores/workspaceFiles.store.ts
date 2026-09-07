import { defineStore } from "pinia";
import { codexDesktop } from "../api/codexDesktopClient";
import { getRuntimeOrchestrator } from "../domain/runtimeOrchestrator";
import type { WorkspaceDirectoryEntryState, WorkspaceFileMetadataState, WorkspaceFileSource } from "../domain/types";
import {
  basenameFromPath,
  buildWorkspaceFileSaveTimelineItem,
  buildWorkspaceFileSaveTimelineParamsText,
  detectUnsupportedTextReason,
  isWorkspaceImagePath,
  WORKSPACE_FILE_SAVE_TIMELINE_METHOD,
  workspaceImageMimeFromPath,
  type WorkspaceFileSaveTimelineParams,
} from "../domain/workspaceFiles";
import { readLocalImageDataUrl } from "../features/media/localImageCache";
import { normalizeAbsoluteFsPath } from "../domain/workspacePath";
import { useRuntimeStore } from "./runtime.store";
import { useTimelineStore } from "./timeline.store";
import { showToast } from "../ui/toast";
import { translate } from "../i18n/translate";
import type {
  AppTextEncoding,
  AppTextLineEnding,
  WorkspaceGitStatusCode,
  WorkspaceGitStatusEntry,
  WorkspaceGitDiffResult,
} from "@codenexus/shared/ipc/contracts";

type ConfirmDiscardOptions = {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  path?: string;
  detail?: string;
  discardOnConfirm?: boolean;
};

const GIT_STATUS_PRIORITY: WorkspaceGitStatusCode[] = ["U", "A", "D", "R", "C", "M", "?"];
const gitStatusRefreshTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();
const workspaceRefreshJobs = new WeakMap<
  object,
  { timer?: ReturnType<typeof setTimeout>; running: boolean; again: boolean }
>();
const AUTO_REFRESH_IGNORED = new Set(["node_modules", ".git", "dist", "release", ".cache"]);

function insideWorkspace(workspace: string, path: string): boolean {
  const root = toComparablePath(workspace).replace(/\/+$/, "");
  const target = toComparablePath(path);
  return Boolean(root && (target === root || target.startsWith(`${root}/`)));
}

async function confirmModalLazy(options: Parameters<(typeof import("../ui/modal"))["confirmModal"]>[0]) {
  const { confirmModal } = await import("../ui/modal");
  return confirmModal(options);
}

export type WorkspaceEditorTabState = {
  path: string;
  source: WorkspaceFileSource | null;
  metadata: WorkspaceFileMetadataState | null;
  previewKind: "text" | "image";
  originalContent: string;
  draftContent: string;
  imageDataUrl: string;
  imageMimeType: string;
  encoding: AppTextEncoding;
  lineEnding: AppTextLineEnding;
  unsupportedReason: string;
  errorText: string;
  loading: boolean;
  saving: boolean;
};

function uniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeAbsoluteFsPath(value);
    if (!normalized) continue;
    const key = toComparablePath(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function withoutPath(values: string[], target: string): string[] {
  const targetKey = toComparablePath(target);
  return values.filter((value) => toComparablePath(value) !== targetKey);
}

function directoryKey(path: string): string {
  return toComparablePath(path);
}

function parentDirectoryPath(path: string): string {
  const normalized = normalizeAbsoluteFsPath(path);
  if (!normalized) return "";
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized) || /^\/\/[^/]+\/[^/]+$/.test(normalized)) {
    return normalized;
  }
  const next = normalized.replace(/\/+$/, "").replace(/\/[^/]+$/, "");
  return next || normalized;
}

function directoryPathForFile(filePath: string): string {
  const normalized = normalizeAbsoluteFsPath(filePath);
  if (!normalized) return "";
  return parentDirectoryPath(normalized);
}

function buildAncestorDirectories(workspacePath: string, targetDirectoryPath: string): string[] {
  const workspace = normalizeAbsoluteFsPath(workspacePath);
  let current = normalizeAbsoluteFsPath(targetDirectoryPath);
  if (!workspace || !current) return [];
  if (!current.startsWith(workspace)) return [workspace];
  const chain: string[] = [];
  while (current) {
    chain.push(current);
    if (isSamePath(current, workspace)) break;
    const parent = parentDirectoryPath(current);
    if (!parent || isSamePath(parent, current)) break;
    current = parent;
  }
  return uniquePaths(chain.reverse());
}

function normalizeWorkspacePath(value: string): string {
  return String(value ?? "").trim();
}

function toComparablePath(value: string): string {
  const normalized = normalizeAbsoluteFsPath(value);
  if (!normalized) return "";
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")) {
    return normalized.toLowerCase();
  }
  return normalized;
}

function isSamePath(a: string, b: string): boolean {
  return toComparablePath(a) === toComparablePath(b);
}

function gitStatusPriority(code: WorkspaceGitStatusCode): number {
  const index = GIT_STATUS_PRIORITY.indexOf(code);
  return index >= 0 ? index : GIT_STATUS_PRIORITY.length;
}

function chooseHigherPriorityGitStatus(
  current: WorkspaceGitStatusEntry | null,
  next: WorkspaceGitStatusEntry
): WorkspaceGitStatusEntry {
  if (!current) return next;
  return gitStatusPriority(next.code) < gitStatusPriority(current.code) ? next : current;
}

function createEditorTabState(path: string): WorkspaceEditorTabState {
  const normalized = normalizeAbsoluteFsPath(path);
  return {
    path: normalized,
    source: null,
    metadata: null,
    previewKind: "text",
    originalContent: "",
    draftContent: "",
    imageDataUrl: "",
    imageMimeType: "",
    encoding: "UTF-8",
    lineEnding: "LF",
    unsupportedReason: "",
    errorText: "",
    loading: true,
    saving: false,
  };
}

function resolveExistingTabPath(tabsByPath: Record<string, WorkspaceEditorTabState>, path: string): string {
  const normalized = normalizeAbsoluteFsPath(path);
  if (!normalized) return "";
  if (tabsByPath[normalized]) return normalized;
  return Object.keys(tabsByPath).find((key) => isSamePath(key, normalized)) ?? "";
}

function isTabDirty(tab: WorkspaceEditorTabState | null | undefined): boolean {
  if (!tab) return false;
  if (tab.previewKind !== "text") return false;
  return tab.draftContent !== tab.originalContent;
}

function buildDirtyTabsDetail(tabs: WorkspaceEditorTabState[]): string {
  if (tabs.length === 0) return "";
  const names = tabs.slice(0, 4).map((tab) => basenameFromPath(tab.path) || tab.path);
  const joinedNames = names.join(translate("workspaceFiles.dirtyTabsNameSeparator"));
  if (tabs.length <= 4) return joinedNames;
  return translate("workspaceFiles.dirtyTabsSummary", { names: joinedNames, count: tabs.length });
}

export const useWorkspaceFilesStore = defineStore("workspaceFiles", {
  state: () => ({
    workspaceRevision: 0,
    gitDiff: { status: "unavailable", diffText: "", skipped: 0 } as WorkspaceGitDiffResult,
    gitDiffRequest: 0,
    directoryLoadVersions: {} as Record<string, number>,
    workspacePath: "" as string,
    directoryPath: "" as string,
    entries: [] as WorkspaceDirectoryEntryState[],
    directoryLoading: false,
    directoryErrorText: "" as string,
    treeEntriesByPath: {} as Record<string, WorkspaceDirectoryEntryState[]>,
    treeLoadingPaths: [] as string[],
    treeErrorTextByPath: {} as Record<string, string>,
    expandedDirectoryPaths: [] as string[],
    deletingFilePaths: [] as string[],
    gitStatusByPath: {} as Record<string, WorkspaceGitStatusEntry>,
    editorTabOrder: [] as string[],
    editorTabsByPath: {} as Record<string, WorkspaceEditorTabState>,
    activeEditorTabPath: "" as string,
  }),
  getters: {
    hasWorkspace(state): boolean {
      return Boolean(state.workspacePath);
    },
    directoryEntriesByPath(state): (path: string) => WorkspaceDirectoryEntryState[] {
      return (path: string) => {
        const key = directoryKey(path);
        return key ? (state.treeEntriesByPath[key] ?? []) : [];
      };
    },
    isDirectoryExpanded(state): (path: string) => boolean {
      return (path: string) => {
        const key = directoryKey(path);
        return key ? state.expandedDirectoryPaths.some((value) => directoryKey(value) === key) : false;
      };
    },
    isDirectoryLoading(state): (path: string) => boolean {
      return (path: string) => {
        const key = directoryKey(path);
        return key ? state.treeLoadingPaths.some((value) => directoryKey(value) === key) : false;
      };
    },
    directoryErrorByPath(state): (path: string) => string {
      return (path: string) => {
        const key = directoryKey(path);
        return key ? String(state.treeErrorTextByPath[key] ?? "") : "";
      };
    },
    openTabs(state): WorkspaceEditorTabState[] {
      return state.editorTabOrder
        .map((path) => state.editorTabsByPath[path])
        .filter((tab): tab is WorkspaceEditorTabState => Boolean(tab));
    },
    activeTab(state): WorkspaceEditorTabState | null {
      const key = resolveExistingTabPath(state.editorTabsByPath, state.activeEditorTabPath);
      return key ? (state.editorTabsByPath[key] ?? null) : null;
    },
    hasOpenTabs(state): boolean {
      return state.editorTabOrder.length > 0;
    },
    hasActiveFile(): boolean {
      return Boolean(this.activeFilePath);
    },
    activeFilePath(): string {
      return this.activeTab?.path ?? "";
    },
    activeFileName(): string {
      return basenameFromPath(this.activeFilePath);
    },
    activeFileSource(): WorkspaceFileSource | null {
      return this.activeTab?.source ?? null;
    },
    activeFileMetadata(): WorkspaceFileMetadataState | null {
      return this.activeTab?.metadata ?? null;
    },
    activeFileOriginalContent(): string {
      return this.activeTab?.originalContent ?? "";
    },
    activeFileDraftContent(): string {
      return this.activeTab?.draftContent ?? "";
    },
    activeFilePreviewKind(): "text" | "image" {
      return this.activeTab?.previewKind ?? "text";
    },
    activeFileImageDataUrl(): string {
      return this.activeTab?.imageDataUrl ?? "";
    },
    activeFileImageMimeType(): string {
      return this.activeTab?.imageMimeType ?? "";
    },
    activeFileUnsupportedReason(): string {
      return this.activeTab?.unsupportedReason ?? "";
    },
    fileErrorText(): string {
      return this.activeTab?.errorText ?? "";
    },
    fileLoading(): boolean {
      return Boolean(this.activeTab?.loading);
    },
    saving(): boolean {
      return Boolean(this.activeTab?.saving);
    },
    isDirty(): boolean {
      return isTabDirty(this.activeTab);
    },
    hasDirtyTabs(): boolean {
      return this.openTabs.some((tab) => isTabDirty(tab));
    },
    isTabDirty(state): (path: string) => boolean {
      return (path: string) => {
        const key = resolveExistingTabPath(state.editorTabsByPath, path);
        return isTabDirty(key ? state.editorTabsByPath[key] : null);
      };
    },
    isFileDeleting(state): (path: string) => boolean {
      return (path: string) => {
        const key = toComparablePath(path);
        return key ? state.deletingFilePaths.some((value) => toComparablePath(value) === key) : false;
      };
    },
    gitStatusForPath(state): (path: string) => WorkspaceGitStatusEntry | null {
      return (path: string) => {
        const key = toComparablePath(path);
        return key ? (state.gitStatusByPath[key] ?? null) : null;
      };
    },
    gitStatusForDirectory(state): (path: string) => WorkspaceGitStatusEntry | null {
      return (path: string) => {
        const directoryKeyValue = toComparablePath(path);
        if (!directoryKeyValue) return null;
        const prefix = directoryKeyValue.endsWith("/") ? directoryKeyValue : `${directoryKeyValue}/`;
        let selected: WorkspaceGitStatusEntry | null = state.gitStatusByPath[directoryKeyValue] ?? null;
        for (const [entryKey, entry] of Object.entries(state.gitStatusByPath)) {
          if (entryKey === directoryKeyValue || entryKey.startsWith(prefix)) {
            selected = chooseHigherPriorityGitStatus(selected, entry);
          }
        }
        return selected;
      };
    },
    canEditActiveFile(): boolean {
      const activeTab = this.activeTab;
      if (!activeTab?.path) return false;
      return activeTab.previewKind === "text" && !activeTab.loading && !activeTab.unsupportedReason;
    },
    canSaveActiveFile(): boolean {
      return this.canEditActiveFile && this.isDirty && !this.fileLoading && !this.saving;
    },
  },
  actions: {
    resetState(workspacePathValue = "") {
      this.cancelWorkspaceRefresh();
      this.gitDiff = { status: "unavailable", diffText: "", skipped: 0 };
      this.directoryLoadVersions = {};
      this.workspacePath = normalizeWorkspacePath(workspacePathValue);
      this.directoryPath = this.workspacePath;
      this.entries = [];
      this.directoryLoading = false;
      this.directoryErrorText = "";
      this.treeEntriesByPath = {};
      this.treeLoadingPaths = [];
      this.treeErrorTextByPath = {};
      this.expandedDirectoryPaths = this.workspacePath ? [this.workspacePath] : [];
      this.deletingFilePaths = [];
      this.gitStatusByPath = {};
      this.clearEditorState();
    },
    clearEditorState() {
      this.editorTabOrder = [];
      this.editorTabsByPath = {};
      this.activeEditorTabPath = "";
    },
    getTreeCacheStats() {
      const entriesGroups = Object.values(this.treeEntriesByPath ?? {});
      const items = entriesGroups.reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0);
      let bytes = 0;
      for (const [path, list] of Object.entries(this.treeEntriesByPath ?? {})) {
        bytes += path.length;
        bytes += JSON.stringify(list).length;
      }
      return {
        items,
        bytes,
        updatedAt: Date.now(),
      };
    },
    clearTreeCache() {
      this.treeEntriesByPath = {};
      this.treeLoadingPaths = [];
      this.treeErrorTextByPath = {};
      this.gitStatusByPath = {};
      if (this.directoryPath) {
        this.entries = [];
        this.directoryErrorText = "";
      }
    },
    syncWorkspace(): boolean {
      const runtimeStore = useRuntimeStore();
      const workspace = normalizeWorkspacePath(runtimeStore.workspacePath);
      if (workspace === this.workspacePath) return false;
      this.resetState(workspace);
      return true;
    },
    resolveTabPath(path?: string): string {
      const raw = normalizeAbsoluteFsPath(String(path ?? this.activeEditorTabPath ?? "").trim());
      if (!raw) return "";
      return resolveExistingTabPath(this.editorTabsByPath, raw) || raw;
    },
    ensureEditorTab(path: string): string {
      const normalized = normalizeAbsoluteFsPath(path);
      if (!normalized) return "";
      const existing = resolveExistingTabPath(this.editorTabsByPath, normalized);
      if (existing) return existing;
      const next = createEditorTabState(normalized);
      this.editorTabsByPath = {
        ...this.editorTabsByPath,
        [normalized]: next,
      };
      this.editorTabOrder = uniquePaths([...this.editorTabOrder, normalized]);
      return normalized;
    },
    renameEditorTab(fromPath: string, toPath: string): string {
      const fromKey = resolveExistingTabPath(this.editorTabsByPath, fromPath);
      const toKey = normalizeAbsoluteFsPath(toPath);
      if (!fromKey || !toKey || isSamePath(fromKey, toKey)) return fromKey || toKey || "";
      const existingTarget = resolveExistingTabPath(this.editorTabsByPath, toKey);
      const tab = this.editorTabsByPath[fromKey];
      if (!tab) return existingTarget || "";
      const nextTabs = { ...this.editorTabsByPath };
      delete nextTabs[fromKey];
      nextTabs[toKey] = { ...tab, path: toKey };
      this.editorTabsByPath = nextTabs;
      this.editorTabOrder = uniquePaths(
        this.editorTabOrder.map((value) => (isSamePath(value, fromKey) ? toKey : value))
      );
      if (isSamePath(this.activeEditorTabPath, fromKey)) {
        this.activeEditorTabPath = toKey;
      }
      return toKey;
    },
    removeEditorTab(path: string) {
      const target = resolveExistingTabPath(this.editorTabsByPath, path);
      if (!target) return false;
      const currentOrder = [...this.editorTabOrder];
      const currentIndex = currentOrder.findIndex((value) => isSamePath(value, target));
      const nextOrder = withoutPath(currentOrder, target);
      const nextTabs = { ...this.editorTabsByPath };
      delete nextTabs[target];
      this.editorTabsByPath = nextTabs;
      this.editorTabOrder = nextOrder;
      if (isSamePath(this.activeEditorTabPath, target)) {
        const fallbackIndex = currentIndex < 0 ? nextOrder.length - 1 : Math.min(currentIndex, nextOrder.length - 1);
        this.activeEditorTabPath = fallbackIndex >= 0 ? (nextOrder[fallbackIndex] ?? "") : "";
      } else if (this.activeEditorTabPath && !resolveExistingTabPath(nextTabs, this.activeEditorTabPath)) {
        this.activeEditorTabPath = nextOrder[0] ?? "";
      }
      return true;
    },
    activateTab(path: string): boolean {
      const target = resolveExistingTabPath(this.editorTabsByPath, path);
      if (!target) return false;
      this.activeEditorTabPath = target;
      return true;
    },
    activateAdjacentTab(direction: 1 | -1): boolean {
      const order = [...this.editorTabOrder];
      if (order.length <= 1) return false;
      const currentIndex = order.findIndex((value) => isSamePath(value, this.activeEditorTabPath));
      if (currentIndex < 0) {
        this.activeEditorTabPath = direction > 0 ? (order[0] ?? "") : (order[order.length - 1] ?? "");
        return Boolean(this.activeEditorTabPath);
      }
      const nextIndex = (currentIndex + direction + order.length) % order.length;
      this.activeEditorTabPath = order[nextIndex] ?? "";
      return Boolean(this.activeEditorTabPath);
    },
    setDraftContent(content: string, path?: string) {
      const target = resolveExistingTabPath(this.editorTabsByPath, this.resolveTabPath(path));
      if (!target) return;
      const tab = this.editorTabsByPath[target];
      if (!tab) return;
      tab.draftContent = String(content ?? "");
      tab.errorText = tab.unsupportedReason || "";
    },
    discardUnsavedChanges(path?: string) {
      const target = resolveExistingTabPath(this.editorTabsByPath, this.resolveTabPath(path));
      if (!target) return;
      const tab = this.editorTabsByPath[target];
      if (!tab) return;
      tab.draftContent = tab.originalContent;
      tab.errorText = tab.unsupportedReason || "";
    },
    clearActiveFile() {
      if (!this.activeEditorTabPath) {
        this.clearEditorState();
        return;
      }
      this.removeEditorTab(this.activeEditorTabPath);
    },
    async confirmDiscardUnsavedIfNeeded(options?: ConfirmDiscardOptions): Promise<boolean> {
      const target = resolveExistingTabPath(this.editorTabsByPath, this.resolveTabPath(options?.path));
      const tab = target ? this.editorTabsByPath[target] : null;
      if (!isTabDirty(tab)) return true;
      const detail = options?.detail ?? tab?.path ?? "";
      const confirmed = await confirmModalLazy({
        title: options?.title ?? translate("workspaceFiles.discardUnsavedTitle"),
        message: options?.message ?? translate("workspaceFiles.discardUnsavedMessage"),
        detail,
        confirmText: options?.confirmText ?? translate("workspaceFiles.discardUnsavedConfirm"),
        cancelText: options?.cancelText ?? translate("workspaceFiles.keepEditing"),
        danger: true,
      });
      if (confirmed && (options?.discardOnConfirm ?? true)) {
        this.discardUnsavedChanges(target);
      }
      return confirmed;
    },
    async confirmCloseDirtyTab(path: string): Promise<boolean> {
      return await this.confirmDiscardUnsavedIfNeeded({
        path,
        title: translate("workspaceFiles.closeDirtyTabTitle"),
        message: translate("workspaceFiles.closeDirtyTabMessage"),
        confirmText: translate("workspaceFiles.closeDirtyTabConfirm"),
        discardOnConfirm: false,
      });
    },
    async closeTab(path: string): Promise<boolean> {
      const target = resolveExistingTabPath(this.editorTabsByPath, path);
      if (!target) return true;
      const confirmed = await this.confirmCloseDirtyTab(target);
      if (!confirmed) return false;
      this.removeEditorTab(target);
      if (this.activeEditorTabPath) {
        void this.revealFileInTree(this.activeEditorTabPath, { setDirectory: true });
      }
      return true;
    },
    async closeActiveTab(): Promise<boolean> {
      if (!this.activeEditorTabPath) return true;
      return await this.closeTab(this.activeEditorTabPath);
    },
    async deleteWorkspaceFile(path: string): Promise<boolean> {
      this.syncWorkspace();
      if (!this.workspacePath) return false;
      const targetPath = normalizeAbsoluteFsPath(String(path ?? "").trim());
      if (!targetPath) return false;
      const deletingKey = toComparablePath(targetPath);
      if (!deletingKey || this.deletingFilePaths.some((value) => toComparablePath(value) === deletingKey)) return false;

      const tabPath = resolveExistingTabPath(this.editorTabsByPath, targetPath);
      const dirty = tabPath ? this.isTabDirty(tabPath) : false;
      const confirmed = await confirmModalLazy({
        title: translate("workspaceFiles.deleteTitle"),
        message: dirty ? translate("workspaceFiles.deleteDirtyMessage") : translate("workspaceFiles.deleteMessage"),
        detail: targetPath,
        confirmText: translate("workspaceFiles.deleteFile"),
        cancelText: translate("common.cancel"),
        danger: true,
      });
      if (!confirmed) return false;

      this.deletingFilePaths = uniquePaths([...this.deletingFilePaths, targetPath]);
      try {
        const runtime = getRuntimeOrchestrator();
        const metadata = await runtime.getWorkspaceMetadata(targetPath);
        if (!metadata.isFile) throw new Error(translate("workspaceFiles.deleteNotFile"));
        await runtime.deleteWorkspaceFile(targetPath);

        if (tabPath) this.removeEditorTab(tabPath);
        const parentDirectory = directoryPathForFile(targetPath);
        if (parentDirectory) {
          await this.ensureDirectoryLoaded(parentDirectory, { force: true });
          if (isSamePath(this.directoryPath, parentDirectory)) {
            this.entries = [...this.directoryEntriesByPath(parentDirectory)];
            this.directoryErrorText = this.directoryErrorByPath(parentDirectory);
          }
        }

        showToast({
          kind: "success",
          title: translate("workspaceFiles.deletedTitle"),
          message: basenameFromPath(targetPath) || targetPath,
        });
        this.scheduleGitStatusRefresh(80);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        showToast({
          kind: "error",
          title: translate("workspaceFiles.deleteFailedTitle"),
          message,
        });
        return false;
      } finally {
        this.deletingFilePaths = withoutPath(this.deletingFilePaths, targetPath);
      }
    },
    async confirmResetDirtyTabsForWorkspaceChange(nextWorkspace?: string): Promise<boolean> {
      const dirtyTabs = this.openTabs.filter((tab) => isTabDirty(tab));
      if (dirtyTabs.length === 0) return true;
      const confirmed = await confirmModalLazy({
        title: translate("workspaceFiles.switchWorkspaceTitle"),
        message: nextWorkspace
          ? translate("workspaceFiles.switchWorkspaceWithNextMessage")
          : translate("workspaceFiles.switchWorkspaceMessage"),
        detail: buildDirtyTabsDetail(dirtyTabs),
        confirmText: translate("workspaceFiles.switchWorkspaceConfirm"),
        cancelText: translate("workspaceFiles.keepEditing"),
        danger: true,
      });
      // The subsequent main-process authorization can still be cancelled.
      // resetState clears tabs only once the workspace actually changes.
      return confirmed;
    },
    async prepareToHidePane(): Promise<boolean> {
      return true;
    },
    async revealFileInTree(path: string, options?: { setDirectory?: boolean }): Promise<boolean> {
      const targetPath = normalizeAbsoluteFsPath(path);
      if (!targetPath || !this.workspacePath) return false;
      const parentDirectory = directoryPathForFile(targetPath);
      if (!parentDirectory) return false;
      try {
        await this.ensureDirectoryVisible(parentDirectory);
        if (options?.setDirectory ?? true) {
          this.directoryPath = parentDirectory;
          this.entries = [...this.directoryEntriesByPath(parentDirectory)];
          this.directoryErrorText = this.directoryErrorByPath(parentDirectory);
        }
        return true;
      } catch (error) {
        this.directoryErrorText = error instanceof Error ? error.message : String(error ?? "unknown error");
        return false;
      }
    },
    setDirectoryLoading(path: string, loading: boolean) {
      const normalized = normalizeAbsoluteFsPath(path);
      if (!normalized) return;
      if (loading) {
        this.treeLoadingPaths = uniquePaths([...this.treeLoadingPaths, normalized]);
        if (isSamePath(normalized, this.directoryPath)) this.directoryLoading = true;
        return;
      }
      this.treeLoadingPaths = withoutPath(this.treeLoadingPaths, normalized);
      if (isSamePath(normalized, this.directoryPath)) this.directoryLoading = false;
    },
    setDirectoryError(path: string, errorText: string) {
      const normalized = normalizeAbsoluteFsPath(path);
      if (!normalized) return;
      const key = directoryKey(normalized);
      const next = { ...this.treeErrorTextByPath };
      const text = String(errorText ?? "").trim();
      if (text) next[key] = text;
      else delete next[key];
      this.treeErrorTextByPath = next;
      if (isSamePath(normalized, this.directoryPath)) this.directoryErrorText = text;
    },
    setDirectoryEntries(path: string, entries: WorkspaceDirectoryEntryState[]) {
      const normalized = normalizeAbsoluteFsPath(path);
      if (!normalized) return;
      const key = directoryKey(normalized);
      this.treeEntriesByPath = {
        ...this.treeEntriesByPath,
        [key]: Array.isArray(entries) ? [...entries] : [],
      };
      if (isSamePath(normalized, this.directoryPath)) {
        this.entries = Array.isArray(entries) ? [...entries] : [];
      }
    },
    async refreshGitStatus(): Promise<boolean> {
      this.syncWorkspace();
      const workspace = normalizeAbsoluteFsPath(this.workspacePath);
      const revision = this.workspaceRevision;
      if (!workspace) {
        this.gitStatusByPath = {};
        return false;
      }
      try {
        const result = await codexDesktop.workspace.readGitStatus({ cwd: workspace });
        if (revision !== this.workspaceRevision || workspace !== this.workspacePath) return false;
        if (!result.ok) {
          this.gitStatusByPath = {};
          return false;
        }
        const next: Record<string, WorkspaceGitStatusEntry> = {};
        for (const entry of result.entries) {
          if (!insideWorkspace(workspace, entry.path)) continue;
          const key = toComparablePath(entry.path);
          if (!key) continue;
          next[key] = entry;
        }
        this.gitStatusByPath = next;
        return true;
      } catch (error) {
        if (revision !== this.workspaceRevision) return false;
        this.gitStatusByPath = {};
        return false;
      }
    },
    scheduleGitStatusRefresh(delayMs = 240) {
      clearTimeout(gitStatusRefreshTimers.get(this));
      const workspace = this.workspacePath;
      gitStatusRefreshTimers.set(
        this,
        setTimeout(
          () => {
            gitStatusRefreshTimers.delete(this);
            if (workspace === this.workspacePath) void this.refreshGitStatus();
          },
          Math.max(0, delayMs)
        )
      );
    },
    cancelWorkspaceRefresh() {
      this.workspaceRevision += 1;
      this.treeLoadingPaths = [];
      this.directoryLoading = false;
      clearTimeout(gitStatusRefreshTimers.get(this));
      gitStatusRefreshTimers.delete(this);
      clearTimeout(workspaceRefreshJobs.get(this)?.timer);
      workspaceRefreshJobs.delete(this);
    },
    scheduleWorkspaceRefresh(workspace: string) {
      if (!workspace || !isSamePath(workspace, useRuntimeStore().workspacePath)) return;
      this.syncWorkspace();
      const existing = workspaceRefreshJobs.get(this);
      if (existing) {
        existing.again = existing.running;
        return;
      }
      const revision = this.workspaceRevision;
      const job = { running: false, again: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      workspaceRefreshJobs.set(this, job);
      job.timer = setTimeout(async () => {
        job.running = true;
        try {
          if (revision !== this.workspaceRevision || !isSamePath(workspace, useRuntimeStore().workspacePath)) return;
          const paths = uniquePaths([workspace, this.directoryPath, ...this.expandedDirectoryPaths])
            .filter(
              (path) =>
                insideWorkspace(workspace, path) &&
                !path
                  .slice(workspace.length)
                  .split("/")
                  .some((p) => AUTO_REFRESH_IGNORED.has(p))
            )
            .slice(0, 32);
          await Promise.all(paths.map((path) => this.ensureDirectoryLoaded(path, { force: true }).catch(() => [])));
          if (revision === this.workspaceRevision) await Promise.all([this.refreshGitStatus(), this.refreshGitDiff()]);
        } finally {
          if (workspaceRefreshJobs.get(this) === job) {
            workspaceRefreshJobs.delete(this);
            if (job.again && revision === this.workspaceRevision) this.scheduleWorkspaceRefresh(workspace);
          }
        }
      }, 250);
    },
    async refreshGitDiff() {
      const workspace = this.workspacePath;
      const revision = this.workspaceRevision;
      const request = ++this.gitDiffRequest;
      if (!workspace) return;
      try {
        const result = await codexDesktop.workspace.readGitDiff({ cwd: workspace });
        if (revision === this.workspaceRevision && request === this.gitDiffRequest) this.gitDiff = result;
      } catch {
        if (revision === this.workspaceRevision && request === this.gitDiffRequest)
          this.gitDiff = { status: "unavailable", diffText: "", skipped: 0 };
      }
    },
    async ensureDirectoryLoaded(path: string, options?: { force?: boolean }): Promise<WorkspaceDirectoryEntryState[]> {
      const normalized = normalizeAbsoluteFsPath(path);
      if (!normalized || !insideWorkspace(this.workspacePath, normalized)) return [];
      const key = directoryKey(normalized);
      if (!options?.force && Array.isArray(this.treeEntriesByPath[key])) {
        const cached = this.treeEntriesByPath[key] ?? [];
        if (isSamePath(normalized, this.directoryPath)) {
          this.entries = [...cached];
          this.directoryErrorText = this.directoryErrorByPath(normalized);
        }
        return cached;
      }
      const runtime = getRuntimeOrchestrator();
      const revision = this.workspaceRevision;
      const version = (this.directoryLoadVersions[key] ?? 0) + 1;
      this.directoryLoadVersions[key] = version;
      const isCurrent = () => revision === this.workspaceRevision && version === this.directoryLoadVersions[key];
      this.setDirectoryLoading(normalized, true);
      this.setDirectoryError(normalized, "");
      try {
        const result = await runtime.readWorkspaceDirectory(normalized);
        if (!isCurrent()) return [];
        this.setDirectoryEntries(normalized, result.entries);
        this.setDirectoryError(normalized, "");
        return result.entries;
      } catch (error) {
        if (!isCurrent()) return [];
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.setDirectoryError(normalized, message);
        if (isSamePath(normalized, this.directoryPath)) {
          this.entries = [];
        }
        throw error;
      } finally {
        if (isCurrent()) this.setDirectoryLoading(normalized, false);
      }
    },
    expandDirectory(path: string) {
      const normalized = normalizeAbsoluteFsPath(path);
      if (!normalized) return;
      this.expandedDirectoryPaths = uniquePaths([...this.expandedDirectoryPaths, normalized]);
    },
    collapseDirectory(path: string) {
      const normalized = normalizeAbsoluteFsPath(path);
      if (!normalized) return;
      this.expandedDirectoryPaths = withoutPath(this.expandedDirectoryPaths, normalized);
    },
    async ensureDirectoryVisible(path: string, options?: { force?: boolean }): Promise<void> {
      const normalized = normalizeAbsoluteFsPath(path);
      if (!normalized || !insideWorkspace(this.workspacePath, normalized)) return;
      const ancestors = buildAncestorDirectories(this.workspacePath, normalized);
      const revision = this.workspaceRevision;
      for (const dirPath of ancestors) {
        if (revision !== this.workspaceRevision) return;
        this.expandDirectory(dirPath);
        await this.ensureDirectoryLoaded(dirPath, options);
      }
    },
    async ensureReady(force = false): Promise<void> {
      const changed = this.syncWorkspace();
      if (!this.workspacePath) return;
      if (changed || !this.directoryPath) {
        this.directoryPath = this.workspacePath;
        this.expandDirectory(this.workspacePath);
      }
      if (changed || force || this.entries.length === 0) {
        await this.openDirectory(this.directoryPath || this.workspacePath, { force, keepActiveFile: !changed });
      }
      if (changed || force || Object.keys(this.gitStatusByPath).length === 0) {
        this.scheduleGitStatusRefresh(80);
      }
    },
    async openDirectory(path: string, options?: { force?: boolean; keepActiveFile?: boolean }): Promise<boolean> {
      this.syncWorkspace();
      if (!this.workspacePath) return false;
      const nextPath = normalizeAbsoluteFsPath(String(path ?? "").trim() || this.workspacePath);
      if (!insideWorkspace(this.workspacePath, nextPath)) return false;
      const revision = this.workspaceRevision;
      const sameDir = isSamePath(nextPath, this.directoryPath);
      try {
        await this.ensureDirectoryVisible(nextPath, { force: options?.force });
        if (revision !== this.workspaceRevision) return false;
        this.directoryPath = nextPath;
        this.entries = [...this.directoryEntriesByPath(nextPath)];
        this.directoryErrorText = this.directoryErrorByPath(nextPath);
        if (!sameDir && !options?.keepActiveFile) {
          // 目录切换不影响已打开标签页。
        }
        return true;
      } catch (error) {
        this.directoryErrorText = error instanceof Error ? error.message : String(error ?? "unknown error");
        return false;
      }
    },
    async reloadTreeForThreadSwitch(opts?: { mode?: "full" | "light" }): Promise<boolean> {
      this.syncWorkspace();
      if (!this.workspacePath) return false;
      const mode = opts?.mode === "light" ? "light" : "full";
      const workspaceKey = toComparablePath(this.workspacePath);
      const currentDirectory = normalizeAbsoluteFsPath(this.directoryPath || this.workspacePath) || this.workspacePath;
      const baseTargets =
        mode === "light"
          ? [this.workspacePath, currentDirectory]
          : [this.workspacePath, currentDirectory, ...this.expandedDirectoryPaths];
      const reloadTargets = uniquePaths(baseTargets).filter((path) => {
        const normalized = normalizeAbsoluteFsPath(path);
        if (!normalized) return false;
        const normalizedKey = toComparablePath(normalized);
        return normalizedKey === workspaceKey || normalizedKey.startsWith(`${workspaceKey}/`);
      });

      if (!reloadTargets.some((path) => isSamePath(path, this.workspacePath))) {
        reloadTargets.unshift(this.workspacePath);
      }

      this.expandDirectory(this.workspacePath);
      let succeeded = false;
      for (const path of reloadTargets) {
        try {
          await this.ensureDirectoryLoaded(path, { force: true });
          succeeded = true;
        } catch {}
      }

      const activeDirectory =
        normalizeAbsoluteFsPath(this.directoryPath || currentDirectory || this.workspacePath) || this.workspacePath;
      this.directoryPath = activeDirectory;
      this.entries = [...this.directoryEntriesByPath(activeDirectory)];
      this.directoryErrorText = this.directoryErrorByPath(activeDirectory);
      this.scheduleGitStatusRefresh(120);
      return succeeded;
    },
    async toggleDirectoryExpanded(path: string): Promise<boolean> {
      const normalized = normalizeAbsoluteFsPath(path);
      if (!normalized) return false;
      if (this.isDirectoryExpanded(normalized)) {
        this.collapseDirectory(normalized);
        if (isSamePath(this.directoryPath, normalized)) {
          this.directoryPath = normalized;
        }
        return true;
      }
      try {
        await this.ensureDirectoryVisible(normalized);
        this.directoryPath = normalized;
        this.entries = [...this.directoryEntriesByPath(normalized)];
        this.directoryErrorText = this.directoryErrorByPath(normalized);
        return true;
      } catch (error) {
        this.directoryErrorText = error instanceof Error ? error.message : String(error ?? "unknown error");
        return false;
      }
    },
    async openFile(path: string): Promise<boolean> {
      this.syncWorkspace();
      if (!this.workspacePath) return false;
      const nextPath = normalizeAbsoluteFsPath(String(path ?? "").trim());
      if (!nextPath) return false;

      const existingTab = resolveExistingTabPath(this.editorTabsByPath, nextPath);
      if (existingTab) {
        this.activeEditorTabPath = existingTab;
        await this.revealFileInTree(existingTab, { setDirectory: true });
        return true;
      }

      const parentDirectory = directoryPathForFile(nextPath);
      if (parentDirectory) {
        try {
          await this.ensureDirectoryVisible(parentDirectory);
          this.directoryPath = parentDirectory;
          this.entries = [...this.directoryEntriesByPath(parentDirectory)];
          this.directoryErrorText = this.directoryErrorByPath(parentDirectory);
        } catch (error) {
          this.directoryErrorText = error instanceof Error ? error.message : String(error ?? "unknown error");
        }
      }

      const runtime = getRuntimeOrchestrator();
      const tabPath = this.ensureEditorTab(nextPath);
      if (!tabPath) return false;
      this.activeEditorTabPath = tabPath;
      const tab = this.editorTabsByPath[tabPath];
      if (!tab) return false;
      tab.loading = true;
      tab.saving = false;
      tab.errorText = "";
      tab.unsupportedReason = "";
      tab.previewKind = "text";
      tab.imageDataUrl = "";
      tab.imageMimeType = "";

      try {
        const metadata = await runtime.getWorkspaceMetadata(nextPath);
        let currentPath = resolveExistingTabPath(this.editorTabsByPath, tabPath);
        if (!currentPath) return false;
        const currentTab = this.editorTabsByPath[currentPath];
        if (!currentTab) return false;
        currentTab.metadata = metadata;
        if (!metadata.isFile) {
          currentTab.loading = false;
          currentTab.errorText = translate("workspaceFiles.notEditableFile");
          return false;
        }

        if (isWorkspaceImagePath(nextPath)) {
          const imageDataUrl = await readLocalImageDataUrl(nextPath);
          currentPath = resolveExistingTabPath(this.editorTabsByPath, currentPath);
          if (!currentPath) return false;
          const finalPath = this.renameEditorTab(currentPath, nextPath);
          const finalTab = this.editorTabsByPath[finalPath];
          if (!finalTab) return false;
          finalTab.path = nextPath;
          finalTab.source = "local";
          finalTab.metadata = metadata;
          finalTab.previewKind = "image";
          finalTab.originalContent = "";
          finalTab.draftContent = "";
          finalTab.imageDataUrl = imageDataUrl;
          finalTab.imageMimeType = workspaceImageMimeFromPath(nextPath);
          finalTab.encoding = "UTF-8";
          finalTab.lineEnding = "LF";
          finalTab.unsupportedReason = "";
          finalTab.errorText = "";
          finalTab.loading = false;
          finalTab.saving = false;
          this.activeEditorTabPath = finalPath;
          return true;
        }

        const result = await runtime.readWorkspaceTextFile(nextPath);
        currentPath = resolveExistingTabPath(this.editorTabsByPath, currentPath);
        if (!currentPath) return false;
        const finalPath = this.renameEditorTab(currentPath, result.path);
        const finalTab = this.editorTabsByPath[finalPath];
        if (!finalTab) return false;
        const unsupportedReason = detectUnsupportedTextReason(result.content);
        finalTab.path = result.path;
        finalTab.source = result.source;
        finalTab.metadata = metadata;
        finalTab.previewKind = "text";
        finalTab.originalContent = result.content;
        finalTab.draftContent = result.content;
        finalTab.imageDataUrl = "";
        finalTab.imageMimeType = "";
        finalTab.encoding = result.encoding;
        finalTab.lineEnding = result.lineEnding;
        finalTab.unsupportedReason = unsupportedReason;
        finalTab.errorText = unsupportedReason;
        finalTab.loading = false;
        finalTab.saving = false;
        this.activeEditorTabPath = finalPath;
        return true;
      } catch (error) {
        const currentPath = resolveExistingTabPath(this.editorTabsByPath, tabPath);
        if (currentPath) {
          const currentTab = this.editorTabsByPath[currentPath];
          if (currentTab) {
            currentTab.loading = false;
            currentTab.saving = false;
            currentTab.errorText = error instanceof Error ? error.message : String(error ?? "unknown error");
          }
        }
        return false;
      }
    },
    appendSaveTimelineEvent(payload: {
      path: string;
      source: WorkspaceFileSource;
      status: "success" | "failed";
      chars: number;
      errorText?: string;
    }) {
      const runtimeStore = useRuntimeStore();
      const timelineStore = useTimelineStore();
      const item = buildWorkspaceFileSaveTimelineItem({
        path: payload.path,
        source: payload.source,
        status: payload.status,
        chars: payload.chars,
        errorText: payload.errorText ?? "",
      });
      timelineStore.appendEvent({
        threadId: runtimeStore.timelineKey,
        method: WORKSPACE_FILE_SAVE_TIMELINE_METHOD,
        paramsText: buildWorkspaceFileSaveTimelineParamsText(item),
        params: { item } satisfies WorkspaceFileSaveTimelineParams,
        level: payload.status === "success" ? "info" : "error",
      });
      runtimeStore.requestScrollTimelineToBottom();
    },
    async saveActiveFile(): Promise<boolean> {
      const activePath = resolveExistingTabPath(this.editorTabsByPath, this.activeEditorTabPath);
      if (!activePath) return false;
      const activeTab = this.editorTabsByPath[activePath];
      if (!activeTab || activeTab.loading || activeTab.saving || activeTab.unsupportedReason || !isTabDirty(activeTab))
        return false;
      activeTab.saving = true;
      activeTab.errorText = activeTab.unsupportedReason || "";
      const runtime = getRuntimeOrchestrator();
      try {
        const result = await runtime.writeWorkspaceTextFile(activeTab.path, activeTab.draftContent, {
          encoding: activeTab.encoding,
          lineEnding: activeTab.lineEnding,
        });
        const latestPath = resolveExistingTabPath(this.editorTabsByPath, activePath);
        if (!latestPath) return false;
        const latestTab = this.editorTabsByPath[latestPath];
        if (!latestTab) return false;
        latestTab.originalContent = latestTab.draftContent;
        latestTab.source = result.source;
        latestTab.encoding = result.encoding;
        latestTab.lineEnding = result.lineEnding;
        latestTab.errorText = latestTab.unsupportedReason || "";
        this.appendSaveTimelineEvent({
          path: latestTab.path,
          source: result.source,
          status: "success",
          chars: latestTab.draftContent.length,
        });
        showToast({
          kind: "success",
          title: translate("workspaceFiles.savedTitle"),
          message: translate("workspaceFiles.savedLocalMessage", {
            name: basenameFromPath(latestTab.path) || latestTab.path,
          }),
        });
        this.scheduleGitStatusRefresh(80);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        const source = activeTab.source ?? "local";
        activeTab.errorText = message;
        this.appendSaveTimelineEvent({
          path: activeTab.path,
          source,
          status: "failed",
          chars: activeTab.draftContent.length,
          errorText: message,
        });
        showToast({
          kind: "error",
          title: translate("workspaceFiles.saveFailedTitle"),
          message,
        });
        return false;
      } finally {
        const latestPath = resolveExistingTabPath(this.editorTabsByPath, activePath);
        if (latestPath) {
          const latestTab = this.editorTabsByPath[latestPath];
          if (latestTab) latestTab.saving = false;
        }
      }
    },
  },
});
