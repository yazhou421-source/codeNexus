import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ChevronRight, FileText, Image as ImageIcon, X } from "lucide-react";
import type { HTMLAttributes } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { basenameFromPath } from "../../../domain/workspaceFiles";
import { normalizeAbsoluteFsPath } from "../../../domain/workspacePath";
import { translate } from "../../../i18n/translate";
import { useWorkspaceFilesStore } from "../../../stores/workspaceFiles.store";
import {
  createWorkspaceEditorState,
  getCachedLanguageSupportForPath,
  getLanguageDisplayNameForPath,
  loadLanguageSupportForPath,
  reconfigureWorkspaceEditorLanguage,
} from "../../../ui/codeEditor";

type EditorScrollPosition = { top: number; left: number };

function toComparablePath(value: string): string {
  const normalized = normalizeAbsoluteFsPath(value);
  if (!normalized) return "";
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")) return normalized.toLowerCase();
  return normalized;
}

function relativePathFromWorkspace(workspacePath: string, targetPath: string): string {
  const workspace = normalizeAbsoluteFsPath(workspacePath);
  const target = normalizeAbsoluteFsPath(targetPath);
  if (!target) return "";
  if (!workspace) return target;
  const workspaceKey = toComparablePath(workspace).replace(/\/+$/g, "");
  const targetKey = toComparablePath(target);
  if (workspaceKey === targetKey) return "";
  if (targetKey.startsWith(`${workspaceKey}/`)) return target.slice(workspace.length).replace(/^\/+/, "");
  return target;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(Math.max(0, Math.round(Number(value) || 0)));
}

export default function WorkspaceEditorPane({ className, ...props }: HTMLAttributes<HTMLElement>) {
  const store = useWorkspaceFilesStore();
  const storeRef = useRef(store);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const currentEditorPathRef = useRef("");
  const editorStateByPathRef = useRef(new Map<string, EditorState>());
  const editorScrollByPathRef = useRef(new Map<string, EditorScrollPosition>());
  const pendingScrollRestoreFrameRef = useRef<number | null>(null);
  const removeEditorScrollListenerRef = useRef<(() => void) | null>(null);
  const [cursorPositionLabel, setCursorPositionLabel] = useState(() => translate("workspaceEditor.cursorEmpty"));
  const [selectionSizeLabel, setSelectionSizeLabel] = useState(() => translate("workspaceEditor.selectionEmpty"));
  storeRef.current = store;

  const activeRelativePath =
    relativePathFromWorkspace(store.workspacePath, store.activeFilePath) || store.activeFilePath || translate("workspaceEditor.notRead");
  const breadcrumbs = useMemo(() => {
    const segments = activeRelativePath.split("/").filter(Boolean).slice(0, -1);
    if (segments.length <= 4) return segments;
    return [segments[0] ?? "", "...", ...segments.slice(-2)];
  }, [activeRelativePath]);
  const activeIsImage = store.activeFilePreviewKind === "image" && Boolean(store.activeFileImageDataUrl);
  const activeLanguageLabel = activeIsImage ? translate("lazyImage.image") : getLanguageDisplayNameForPath(store.activeFilePath);
  const activeEncodingLabel = store.activeTab?.encoding ?? "UTF-8";
  const activeLineEndingLabel = store.activeTab?.lineEnding ?? "LF";
  const activeCursorLabel =
    !store.hasActiveFile || store.fileLoading || store.activeFileUnsupportedReason
      ? translate("workspaceEditor.cursorEmpty")
      : cursorPositionLabel;
  const activeSelectionLabel =
    !store.hasActiveFile || store.fileLoading || store.activeFileUnsupportedReason
      ? translate("workspaceEditor.selectionEmpty")
      : selectionSizeLabel;

  const isActiveTab = (path: string) => toComparablePath(path) === toComparablePath(storeRef.current.activeFilePath);

  const getEditorDoc = (state: EditorState): string => state.doc.toString();

  const formatCursorLabel = (state: EditorState | null): string => {
    if (!state) return translate("workspaceEditor.cursorEmpty");
    const mainSelection = state.selection.main;
    const line = state.doc.lineAt(mainSelection.head);
    const column = Math.max(1, mainSelection.head - line.from + 1);
    return translate("workspaceEditor.cursorPosition", { line: line.number, column });
  };

  const formatSelectionLabel = (state: EditorState | null): string => {
    if (!state) return translate("workspaceEditor.selectionEmpty");
    const selectedChars = state.selection.ranges.reduce((sum, range) => sum + Math.abs(range.to - range.from), 0);
    return translate("workspaceEditor.selectionCount", { count: formatCount(selectedChars) });
  };

  const syncCursorLabel = (state: EditorState | null, pathValue = currentEditorPathRef.current) => {
    const path = String(pathValue ?? "").trim();
    if (!path || !isActiveTab(path)) {
      setCursorPositionLabel(translate("workspaceEditor.cursorEmpty"));
      setSelectionSizeLabel(translate("workspaceEditor.selectionEmpty"));
      return;
    }
    setCursorPositionLabel(formatCursorLabel(state));
    setSelectionSizeLabel(formatSelectionLabel(state));
  };

  const saveEditorSession = (pathValue = currentEditorPathRef.current) => {
    const path = String(pathValue ?? "").trim();
    const editorView = editorViewRef.current;
    if (!path || !editorView) return;
    editorStateByPathRef.current.set(path, editorView.state);
    editorScrollByPathRef.current.set(path, {
      top: editorView.scrollDOM.scrollTop,
      left: editorView.scrollDOM.scrollLeft,
    });
  };

  const clearEditorScrollRestoreFrame = () => {
    if (pendingScrollRestoreFrameRef.current == null) return;
    cancelAnimationFrame(pendingScrollRestoreFrameRef.current);
    pendingScrollRestoreFrameRef.current = null;
  };

  const restoreEditorScroll = (pathValue: string) => {
    const path = String(pathValue ?? "").trim();
    const editorView = editorViewRef.current;
    if (!path || !editorView) return;
    const position = editorScrollByPathRef.current.get(path) ?? { top: 0, left: 0 };
    clearEditorScrollRestoreFrame();
    pendingScrollRestoreFrameRef.current = requestAnimationFrame(() => {
      pendingScrollRestoreFrameRef.current = null;
      const currentView = editorViewRef.current;
      if (!currentView || currentEditorPathRef.current !== path) return;
      currentView.scrollDOM.scrollTop = position.top;
      currentView.scrollDOM.scrollLeft = position.left;
    });
  };

  const bindEditorScrollListener = () => {
    removeEditorScrollListenerRef.current?.();
    const editorView = editorViewRef.current;
    if (!editorView) return;
    const scrollDom = editorView.scrollDOM;
    const handleScroll = () => {
      const path = String(currentEditorPathRef.current ?? "").trim();
      if (!path) return;
      editorScrollByPathRef.current.set(path, {
        top: scrollDom.scrollTop,
        left: scrollDom.scrollLeft,
      });
    };
    scrollDom.addEventListener("scroll", handleScroll, { passive: true });
    removeEditorScrollListenerRef.current = () => {
      scrollDom.removeEventListener("scroll", handleScroll);
      removeEditorScrollListenerRef.current = null;
    };
  };

  const teardownEditorView = (options?: { preserveCurrent?: boolean }) => {
    if (options?.preserveCurrent !== false) saveEditorSession();
    removeEditorScrollListenerRef.current?.();
    clearEditorScrollRestoreFrame();
    const editorView = editorViewRef.current;
    if (editorView) {
      editorView.destroy();
      editorViewRef.current = null;
    }
    currentEditorPathRef.current = "";
    setCursorPositionLabel(translate("workspaceEditor.cursorEmpty"));
    setSelectionSizeLabel(translate("workspaceEditor.selectionEmpty"));
  };

  const createEditorStateForPath = (path: string, doc: string): EditorState => {
    return createWorkspaceEditorState({
      doc,
      language: getCachedLanguageSupportForPath(path),
      onDocChange: (nextDoc) => {
        const currentStore = storeRef.current;
        if (currentEditorPathRef.current !== path) return;
        if (!isActiveTab(path)) return;
        if (currentStore.activeFileDraftContent === nextDoc) return;
        currentStore.setDraftContent(nextDoc, path);
      },
      onStateChange: (nextState) => {
        editorStateByPathRef.current.set(path, nextState);
        if (currentEditorPathRef.current === path && isActiveTab(path)) syncCursorLabel(nextState, path);
      },
      onSave: () => {
        const currentStore = storeRef.current;
        if (currentEditorPathRef.current !== path) return;
        if (currentStore.canSaveActiveFile) void currentStore.saveActiveFile();
      },
    });
  };

  const resolveEditorStateForPath = (path: string, doc: string): EditorState => {
    const existing = editorStateByPathRef.current.get(path);
    if (existing && getEditorDoc(existing) === doc) return existing;
    const nextState = createEditorStateForPath(path, doc);
    editorStateByPathRef.current.set(path, nextState);
    return nextState;
  };

  const ensureLanguageLoaded = async (pathValue: string) => {
    const path = String(pathValue ?? "").trim();
    if (!path) return;
    const language = await loadLanguageSupportForPath(path);
    if (!language) return;

    const editorView = editorViewRef.current;
    if (currentEditorPathRef.current === path && editorView) {
      const scrollTop = editorView.scrollDOM.scrollTop;
      const scrollLeft = editorView.scrollDOM.scrollLeft;
      const nextState = reconfigureWorkspaceEditorLanguage(editorView.state, language);
      editorView.setState(nextState);
      editorStateByPathRef.current.set(path, nextState);
      syncCursorLabel(nextState, path);
      editorScrollByPathRef.current.set(path, { top: scrollTop, left: scrollLeft });
      restoreEditorScroll(path);
      return;
    }

    const existing = editorStateByPathRef.current.get(path);
    if (!existing) return;
    editorStateByPathRef.current.set(path, reconfigureWorkspaceEditorLanguage(existing, language));
  };

  const syncEditorView = async () => {
    const path = String(store.activeFilePath ?? "").trim();
    const canRenderEditor =
      Boolean(path) &&
      store.activeFilePreviewKind === "text" &&
      !store.fileLoading &&
      !store.activeFileUnsupportedReason;

    if (!canRenderEditor) {
      teardownEditorView({ preserveCurrent: true });
      return;
    }

    const host = editorHostRef.current;
    if (!host) return;

    const editorView = editorViewRef.current;
    if (editorView && currentEditorPathRef.current && currentEditorPathRef.current !== path) {
      saveEditorSession(currentEditorPathRef.current);
    }

    const nextState = resolveEditorStateForPath(path, store.activeFileDraftContent);
    if (!editorViewRef.current) {
      editorViewRef.current = new EditorView({
        state: nextState,
        parent: host,
      });
      bindEditorScrollListener();
    } else if (editorViewRef.current.state !== nextState) {
      editorViewRef.current.setState(nextState);
    }

    currentEditorPathRef.current = path;
    editorStateByPathRef.current.set(path, nextState);
    syncCursorLabel(nextState, path);
    restoreEditorScroll(path);
    void ensureLanguageLoaded(path);
  };

  const focusEditor = () => {
    editorViewRef.current?.focus();
  };

  const focusTabEditor = async (pathValue: string) => {
    const path = String(pathValue ?? "").trim();
    if (!path) return;
    store.activateTab(path);
    await store.revealFileInTree(path, { setDirectory: true });
    await Promise.resolve();
    await syncEditorView();
    focusEditor();
  };

  const onCloseTab = async (path: string) => {
    if (store.isTabDirty(path)) await focusTabEditor(path);
    await store.closeTab(path);
  };

  const pruneClosedEditorSessions = () => {
    const openPathSet = new Set(store.openTabs.map((tab) => toComparablePath(tab.path)));
    for (const key of [...editorStateByPathRef.current.keys()]) {
      if (!openPathSet.has(toComparablePath(key))) editorStateByPathRef.current.delete(key);
    }
    for (const key of [...editorScrollByPathRef.current.keys()]) {
      if (!openPathSet.has(toComparablePath(key))) editorScrollByPathRef.current.delete(key);
    }
  };

  useEffect(() => {
    void syncEditorView();
  }, [
    store.activeFilePath,
    store.activeFileDraftContent,
    store.activeFilePreviewKind,
    store.fileLoading,
    store.activeFileUnsupportedReason,
  ]);

  useEffect(() => {
    pruneClosedEditorSessions();
  }, [store.openTabs.map((tab) => tab.path).join("\n")]);

  useEffect(() => {
    return () => teardownEditorView({ preserveCurrent: false });
  }, []);

  return (
    <aside {...props} className={["workspace-editor-pane", className].filter(Boolean).join(" ")} aria-label={translate("workspaceEditor.aria")}>
      <div className="workspace-editor-pane__surface">
        <div className="workspace-editor-tabs app-scrollbar" role="tablist" aria-label={translate("workspaceEditor.openFilesAria")}>
          {store.openTabs.map((tab) => {
            const active = normalizeAbsoluteFsPath(tab.path) === normalizeAbsoluteFsPath(store.activeFilePath);
            return (
              <div key={tab.path} className={["workspace-editor-tab", active ? "is-active" : ""].filter(Boolean).join(" ")} role="presentation">
                <button
                  className="workspace-editor-tab__main"
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    store.activateTab(tab.path);
                    void store.revealFileInTree(tab.path, { setDirectory: true });
                  }}
                >
                  {tab.previewKind === "image" ? <ImageIcon className="workspace-editor-tab__icon" aria-hidden="true" /> : <FileText className="workspace-editor-tab__icon" aria-hidden="true" />}
                  <span className="workspace-editor-tab__label">{basenameFromPath(tab.path) || tab.path}</span>
                  {store.isTabDirty(tab.path) ? <span className="workspace-editor-tab__dirty" aria-hidden="true">*</span> : null}
                </button>
                <button className="workspace-editor-tab__close" type="button" onClick={() => void onCloseTab(tab.path)}>
                  <X className="workspace-editor-tab__close-icon" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="workspace-editor-pane__content">
          {!store.hasActiveFile ? (
            <div className="workspace-files-editor-empty">
              <FileText className="workspace-files-editor-empty__icon" aria-hidden="true" />
              <div className="workspace-files-editor-empty__title">{translate("workspaceEditor.emptyTitle")}</div>
              <div className="workspace-files-editor-empty__note">{translate("workspaceEditor.emptyNote")}</div>
            </div>
          ) : (
            <>
              {breadcrumbs.length > 0 ? (
                <div className="workspace-editor-pane__chrome">
                  <div className="workspace-editor-pane__breadcrumbs">
                    {breadcrumbs.map((crumb, index) => (
                      <span key={`${crumb}-${index}`} className="contents">
                        <span
                          className={[
                            "workspace-editor-pane__breadcrumb",
                            crumb === "..." ? "is-ellipsis" : "",
                            index === breadcrumbs.length - 1 ? "is-current" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {crumb}
                        </span>
                        {index < breadcrumbs.length - 1 ? <ChevronRight className="workspace-editor-pane__breadcrumb-sep" aria-hidden="true" /> : null}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {store.fileLoading ? (
                <div className="workspace-files-editor-state">{translate("workspaceEditor.fileLoading")}</div>
              ) : store.activeFileUnsupportedReason ? (
                <div className="workspace-files-editor-error">{store.activeFileUnsupportedReason}</div>
              ) : activeIsImage ? (
                <div className="workspace-editor-image-shell">
                  <div className="workspace-editor-image-stage">
                    <img className="workspace-editor-image" src={store.activeFileImageDataUrl} alt={store.activeFileName || translate("lazyImage.previewTitle")} />
                  </div>
                </div>
              ) : (
                <div className="workspace-editor-code-shell">
                  <div ref={editorHostRef} className="workspace-editor-code-view" aria-label={translate("workspaceEditor.codeEditorAria")} />
                </div>
              )}
              <div className="workspace-editor-statusbar">
                <span className="mono dim workspace-editor-statusbar__language">{activeLanguageLabel}</span>
                {store.activeFilePreviewKind === "text" ? (
                  <>
                    <span className="mono dim">{activeEncodingLabel}</span>
                    <span className="mono dim">{activeLineEndingLabel}</span>
                    <span className="mono dim">{activeCursorLabel}</span>
                    <span className="mono dim">{activeSelectionLabel}</span>
                    <span className="mono dim">{translate("workspaceEditor.charCount", { count: formatCount(store.activeFileDraftContent.length) })}</span>
                  </>
                ) : (
                  <>
                    <span className="mono dim">{store.activeFileImageMimeType || "image/*"}</span>
                    <span className="mono dim">{translate("workspaceEditor.readOnlyPreview")}</span>
                  </>
                )}
                {store.fileErrorText && !store.activeFileUnsupportedReason ? (
                  <span className="workspace-files-editor-footer__error">{store.fileErrorText}</span>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
