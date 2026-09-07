<template>
  <aside class="workspace-editor-pane" :aria-label="t('workspaceEditor.aria')">
    <div class="workspace-editor-pane__surface">
      <div class="workspace-editor-tabs app-scrollbar" role="tablist" :aria-label="t('workspaceEditor.openFilesAria')">
        <div
          v-for="tab in workspaceFilesStore.openTabs"
          :key="tab.path"
          class="workspace-editor-tab"
          :class="{ 'is-active': isActiveTab(tab.path) }"
          role="presentation"
        >
          <button
            class="workspace-editor-tab__main"
            type="button"
            role="tab"
            :aria-selected="isActiveTab(tab.path) ? 'true' : 'false'"
            @click="onActivateTab(tab.path)"
          >
            <ImageIcon v-if="tab.previewKind === 'image'" class="workspace-editor-tab__icon" aria-hidden="true" />
            <FileText v-else class="workspace-editor-tab__icon" aria-hidden="true" />
            <span class="workspace-editor-tab__label">{{ basenameFromPath(tab.path) || tab.path }}</span>
            <span v-if="workspaceFilesStore.isTabDirty(tab.path)" class="workspace-editor-tab__dirty" aria-hidden="true"
              >*</span
            >
          </button>
          <button
            class="workspace-editor-tab__close"
            type="button"
            :aria-label="`${t('common.close')} ${basenameFromPath(tab.path)}`"
            @click.stop="onCloseTab(tab.path)"
          >
            <X class="workspace-editor-tab__close-icon" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="workspace-editor-pane__content">
        <div v-if="!workspaceFilesStore.hasActiveFile" class="workspace-files-editor-empty">
          <FileText class="workspace-files-editor-empty__icon" aria-hidden="true" />
          <div class="workspace-files-editor-empty__title">{{ t("workspaceEditor.emptyTitle") }}</div>
          <div class="workspace-files-editor-empty__note">{{ t("workspaceEditor.emptyNote") }}</div>
        </div>

        <template v-else>
          <div v-if="visibleBreadcrumbs.length > 0" class="workspace-editor-pane__chrome">
            <div class="workspace-editor-pane__breadcrumbs">
              <template v-for="(crumb, index) in visibleBreadcrumbs" :key="`${crumb}-${index}`">
                <span
                  class="workspace-editor-pane__breadcrumb"
                  :class="{ 'is-ellipsis': crumb === '…', 'is-current': index === visibleBreadcrumbs.length - 1 }"
                >
                  {{ crumb }}
                </span>
                <ChevronRight
                  v-if="index < visibleBreadcrumbs.length - 1"
                  class="workspace-editor-pane__breadcrumb-sep"
                  aria-hidden="true"
                />
              </template>
            </div>
          </div>

          <div v-if="workspaceFilesStore.fileLoading" class="workspace-files-editor-state">
            {{ t("workspaceEditor.fileLoading") }}
          </div>
          <div v-else-if="workspaceFilesStore.activeFileUnsupportedReason" class="workspace-files-editor-error">
            {{ workspaceFilesStore.activeFileUnsupportedReason }}
          </div>
          <div v-else-if="activeIsImagePreview" class="workspace-editor-image-shell">
            <div class="workspace-editor-image-stage">
              <img
                class="workspace-editor-image"
                :src="workspaceFilesStore.activeFileImageDataUrl"
                :alt="workspaceFilesStore.activeFileName || t('lazyImage.previewTitle')"
              />
            </div>
          </div>
          <div v-else class="workspace-editor-code-shell">
            <div
              ref="editorHostRef"
              class="workspace-editor-code-view"
              :aria-label="t('workspaceEditor.codeEditorAria')"
            ></div>
          </div>
          <div class="workspace-editor-statusbar">
            <span class="mono dim workspace-editor-statusbar__language">{{ activeLanguageLabel }}</span>
            <template v-if="workspaceFilesStore.activeFilePreviewKind === 'text'">
              <span class="mono dim">{{ activeEncodingLabel }}</span>
              <span class="mono dim">{{ activeLineEndingLabel }}</span>
              <span class="mono dim">{{ activeCursorLabel }}</span>
              <span class="mono dim">{{ activeSelectionLabel }}</span>
              <span class="mono dim">{{
                t("workspaceEditor.charCount", { count: n(workspaceFilesStore.activeFileDraftContent.length) })
              }}</span>
            </template>
            <template v-else-if="activeIsImagePreview">
              <span class="mono dim">{{ activeImageMimeLabel }}</span>
              <span class="mono dim">{{ t("workspaceEditor.readOnlyPreview") }}</span>
            </template>
            <span
              v-if="workspaceFilesStore.fileErrorText && !workspaceFilesStore.activeFileUnsupportedReason"
              class="workspace-files-editor-footer__error"
            >
              {{ workspaceFilesStore.fileErrorText }}
            </span>
          </div>
        </template>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ChevronRight, FileText, Image as ImageIcon, X } from "lucide-vue-next";
import { basenameFromPath } from "../../../domain/workspaceFiles";
import { normalizeAbsoluteFsPath } from "../../../domain/workspacePath";
import { useWorkspaceFilesStore } from "../../../stores/workspaceFiles.store";
import {
  createWorkspaceEditorState,
  getLanguageDisplayNameForPath,
  getCachedLanguageSupportForPath,
  loadLanguageSupportForPath,
  reconfigureWorkspaceEditorLanguage,
} from "../../../ui/codeEditor";

const workspaceFilesStore = useWorkspaceFilesStore();
const { n, t } = useI18n();
const editorHostRef = ref<HTMLDivElement | null>(null);
const currentEditorPath = ref("");
const emptyCursorLabel = () => t("workspaceEditor.cursorEmpty");
const emptySelectionLabel = () => t("workspaceEditor.selectionEmpty");
const cursorPositionLabel = ref(emptyCursorLabel());
const selectionSizeLabel = ref(emptySelectionLabel());

let editorView: EditorView | null = null;
let pendingScrollRestoreFrame: number | null = null;
let removeEditorScrollListener: (() => void) | null = null;

const editorStateByPath = new Map<string, EditorState>();
const editorScrollByPath = new Map<string, { top: number; left: number }>();

function toComparablePath(value: string): string {
  const normalized = normalizeAbsoluteFsPath(value);
  if (!normalized) return "";
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")) {
    return normalized.toLowerCase();
  }
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
  if (targetKey.startsWith(`${workspaceKey}/`)) {
    return target.slice(workspace.length).replace(/^\/+/, "");
  }
  return target;
}

const activeFileRelativePath = computed(() => {
  const relative = relativePathFromWorkspace(workspaceFilesStore.workspacePath, workspaceFilesStore.activeFilePath);
  return relative || workspaceFilesStore.activeFilePath || t("workspaceEditor.notRead");
});

const breadcrumbSegments = computed(() => {
  const segments = activeFileRelativePath.value.split("/").filter(Boolean);
  return segments.slice(0, -1);
});

const visibleBreadcrumbs = computed(() => {
  const segments = [...breadcrumbSegments.value];
  if (segments.length <= 4) return segments;
  return [segments[0] ?? "", "…", ...segments.slice(-2)];
});

const activeLanguageLabel = computed(() => {
  if (workspaceFilesStore.activeFilePreviewKind === "image") return t("lazyImage.image");
  return getLanguageDisplayNameForPath(workspaceFilesStore.activeFilePath);
});

const activeIsImagePreview = computed(
  () => workspaceFilesStore.activeFilePreviewKind === "image" && Boolean(workspaceFilesStore.activeFileImageDataUrl)
);

const activeImageMimeLabel = computed(() => workspaceFilesStore.activeFileImageMimeType || "image/*");

const activeEncodingLabel = computed(() => {
  return workspaceFilesStore.activeTab?.encoding ?? "UTF-8";
});

const activeLineEndingLabel = computed(() => {
  return workspaceFilesStore.activeTab?.lineEnding ?? "LF";
});

const activeCursorLabel = computed(() => {
  if (!workspaceFilesStore.hasActiveFile) return emptyCursorLabel();
  if (workspaceFilesStore.fileLoading || workspaceFilesStore.activeFileUnsupportedReason) {
    return emptyCursorLabel();
  }
  return cursorPositionLabel.value;
});

const activeSelectionLabel = computed(() => {
  if (!workspaceFilesStore.hasActiveFile) return emptySelectionLabel();
  if (workspaceFilesStore.fileLoading || workspaceFilesStore.activeFileUnsupportedReason) {
    return emptySelectionLabel();
  }
  return selectionSizeLabel.value;
});

const isActiveTab = (path: string) => toComparablePath(path) === toComparablePath(workspaceFilesStore.activeFilePath);

const onActivateTab = (path: string) => {
  workspaceFilesStore.activateTab(path);
  void workspaceFilesStore.revealFileInTree(path, { setDirectory: true });
};

function focusEditor() {
  editorView?.focus();
}

async function focusTabEditor(pathValue: string) {
  const path = String(pathValue ?? "").trim();
  if (!path) return;
  workspaceFilesStore.activateTab(path);
  await workspaceFilesStore.revealFileInTree(path, { setDirectory: true });
  await nextTick();
  await syncEditorView();
  focusEditor();
}

const onCloseTab = async (path: string) => {
  if (workspaceFilesStore.isTabDirty(path)) {
    await focusTabEditor(path);
  }
  await workspaceFilesStore.closeTab(path);
};

function getEditorDoc(state: EditorState): string {
  return state.doc.toString();
}

function formatCursorLabel(state: EditorState | null): string {
  if (!state) return emptyCursorLabel();
  const mainSelection = state.selection.main;
  const line = state.doc.lineAt(mainSelection.head);
  const column = Math.max(1, mainSelection.head - line.from + 1);
  return t("workspaceEditor.cursorPosition", { line: line.number, column });
}

function formatSelectionLabel(state: EditorState | null): string {
  if (!state) return emptySelectionLabel();
  const selectedChars = state.selection.ranges.reduce((sum, range) => sum + Math.abs(range.to - range.from), 0);
  return t("workspaceEditor.selectionCount", { count: n(selectedChars) });
}

function syncCursorLabel(state: EditorState | null, pathValue = currentEditorPath.value) {
  const path = String(pathValue ?? "").trim();
  if (!path || !isActiveTab(path)) {
    cursorPositionLabel.value = emptyCursorLabel();
    selectionSizeLabel.value = emptySelectionLabel();
    return;
  }
  cursorPositionLabel.value = formatCursorLabel(state);
  selectionSizeLabel.value = formatSelectionLabel(state);
}

function saveEditorSession(pathValue = currentEditorPath.value) {
  const path = String(pathValue ?? "").trim();
  if (!path || !editorView) return;
  editorStateByPath.set(path, editorView.state);
  editorScrollByPath.set(path, {
    top: editorView.scrollDOM.scrollTop,
    left: editorView.scrollDOM.scrollLeft,
  });
}

function clearEditorScrollRestoreFrame() {
  if (pendingScrollRestoreFrame == null) return;
  cancelAnimationFrame(pendingScrollRestoreFrame);
  pendingScrollRestoreFrame = null;
}

function restoreEditorScroll(pathValue: string) {
  const path = String(pathValue ?? "").trim();
  if (!path || !editorView) return;
  const position = editorScrollByPath.get(path) ?? { top: 0, left: 0 };
  clearEditorScrollRestoreFrame();
  pendingScrollRestoreFrame = requestAnimationFrame(() => {
    pendingScrollRestoreFrame = null;
    if (!editorView || currentEditorPath.value !== path) return;
    editorView.scrollDOM.scrollTop = position.top;
    editorView.scrollDOM.scrollLeft = position.left;
  });
}

function bindEditorScrollListener() {
  removeEditorScrollListener?.();
  if (!editorView) return;
  const scrollDom = editorView.scrollDOM;
  const handleScroll = () => {
    const path = String(currentEditorPath.value ?? "").trim();
    if (!path) return;
    editorScrollByPath.set(path, {
      top: scrollDom.scrollTop,
      left: scrollDom.scrollLeft,
    });
  };
  scrollDom.addEventListener("scroll", handleScroll, { passive: true });
  removeEditorScrollListener = () => {
    scrollDom.removeEventListener("scroll", handleScroll);
    removeEditorScrollListener = null;
  };
}

function teardownEditorView(options?: { preserveCurrent?: boolean }) {
  if (options?.preserveCurrent !== false) {
    saveEditorSession();
  }
  removeEditorScrollListener?.();
  clearEditorScrollRestoreFrame();
  if (editorView) {
    editorView.destroy();
    editorView = null;
  }
  currentEditorPath.value = "";
  cursorPositionLabel.value = emptyCursorLabel();
  selectionSizeLabel.value = emptySelectionLabel();
}

function createEditorStateForPath(path: string, doc: string): EditorState {
  return createWorkspaceEditorState({
    doc,
    language: getCachedLanguageSupportForPath(path),
    onDocChange: (nextDoc) => {
      if (currentEditorPath.value !== path) return;
      if (!isActiveTab(path)) return;
      if (workspaceFilesStore.activeFileDraftContent === nextDoc) return;
      workspaceFilesStore.setDraftContent(nextDoc, path);
    },
    onStateChange: (nextState) => {
      editorStateByPath.set(path, nextState);
      if (currentEditorPath.value === path && isActiveTab(path)) {
        syncCursorLabel(nextState, path);
      }
    },
    onSave: () => {
      if (currentEditorPath.value !== path) return;
      if (workspaceFilesStore.canSaveActiveFile) {
        void workspaceFilesStore.saveActiveFile();
      }
    },
  });
}

function resolveEditorStateForPath(path: string, doc: string): EditorState {
  const existing = editorStateByPath.get(path);
  if (existing && getEditorDoc(existing) === doc) return existing;
  const nextState = createEditorStateForPath(path, doc);
  editorStateByPath.set(path, nextState);
  return nextState;
}

async function ensureLanguageLoaded(pathValue: string) {
  const path = String(pathValue ?? "").trim();
  if (!path) return;
  const language = await loadLanguageSupportForPath(path);
  if (!language) return;

  if (currentEditorPath.value === path && editorView) {
    const scrollTop = editorView.scrollDOM.scrollTop;
    const scrollLeft = editorView.scrollDOM.scrollLeft;
    const nextState = reconfigureWorkspaceEditorLanguage(editorView.state, language);
    editorView.setState(nextState);
    editorStateByPath.set(path, nextState);
    syncCursorLabel(nextState, path);
    editorScrollByPath.set(path, { top: scrollTop, left: scrollLeft });
    restoreEditorScroll(path);
    return;
  }

  const existing = editorStateByPath.get(path);
  if (!existing) return;
  editorStateByPath.set(path, reconfigureWorkspaceEditorLanguage(existing, language));
}

async function syncEditorView() {
  const path = String(workspaceFilesStore.activeFilePath ?? "").trim();
  const canRenderEditor =
    Boolean(path) &&
    workspaceFilesStore.activeFilePreviewKind === "text" &&
    !workspaceFilesStore.fileLoading &&
    !workspaceFilesStore.activeFileUnsupportedReason;

  if (!canRenderEditor) {
    teardownEditorView({ preserveCurrent: true });
    return;
  }

  await nextTick();
  const host = editorHostRef.value;
  if (!host) return;

  if (editorView && currentEditorPath.value && currentEditorPath.value !== path) {
    saveEditorSession(currentEditorPath.value);
  }

  const nextState = resolveEditorStateForPath(path, workspaceFilesStore.activeFileDraftContent);

  if (!editorView) {
    editorView = new EditorView({
      state: nextState,
      parent: host,
    });
    bindEditorScrollListener();
  } else if (editorView.state !== nextState) {
    editorView.setState(nextState);
  }

  currentEditorPath.value = path;
  editorStateByPath.set(path, nextState);
  syncCursorLabel(nextState, path);
  restoreEditorScroll(path);
  void ensureLanguageLoaded(path);
}

function pruneClosedEditorSessions() {
  const openPathSet = new Set(workspaceFilesStore.openTabs.map((tab) => toComparablePath(tab.path)));

  for (const key of [...editorStateByPath.keys()]) {
    if (openPathSet.has(toComparablePath(key))) continue;
    editorStateByPath.delete(key);
  }
  for (const key of [...editorScrollByPath.keys()]) {
    if (openPathSet.has(toComparablePath(key))) continue;
    editorScrollByPath.delete(key);
  }
}

watch(
  () =>
    [
      workspaceFilesStore.activeFilePath,
      workspaceFilesStore.activeFileDraftContent,
      workspaceFilesStore.activeFilePreviewKind,
      workspaceFilesStore.fileLoading,
      workspaceFilesStore.activeFileUnsupportedReason,
    ] as const,
  () => {
    void syncEditorView();
  },
  { flush: "post", immediate: true }
);

watch(
  () => workspaceFilesStore.openTabs.map((tab) => tab.path).join("\n"),
  () => {
    pruneClosedEditorSessions();
  },
  { flush: "post", immediate: true }
);

onBeforeUnmount(() => {
  teardownEditorView({ preserveCurrent: false });
});
</script>
