<template>
  <div
    ref="treeSurfaceRef"
    class="workspace-files-tree-surface app-scrollbar"
    role="tree"
    :aria-label="t('workspaceFiles.treeAria')"
    @wheel="onTreeSurfaceWheel"
    @keydown="onTreeKeydown"
  >
    <div v-if="!workspaceFilesStore.hasWorkspace" class="workspace-files-placeholder">
      {{ t("workspaceFiles.chooseWorkspaceFirst") }}
    </div>
    <div v-else-if="treeRows.length === 0" class="workspace-files-placeholder">
      {{ t("workspaceFiles.notLoaded") }}
    </div>
    <div v-else class="workspace-files-tree-content" :style="treeContentStyle">
      <template v-for="row in treeRows" :key="row.key">
        <button
          v-if="row.kind === 'entry'"
          class="workspace-file-tree-row"
          :class="treeRowClass(row)"
          :style="treeRowStyle(row)"
          type="button"
          role="treeitem"
          draggable="true"
          :aria-level="row.depth + 1"
          :aria-expanded="row.isDirectory ? String(row.isExpanded) : undefined"
          :aria-selected="row.isActiveFile || row.isSelectedDirectory ? 'true' : 'false'"
          :data-tree-path="row.path"
          :title="treeRowTitle(row)"
          @click="onOpenTreeRow(row)"
          @contextmenu="onTreeRowContextMenu(row, $event)"
          @dragstart="onTreeRowDragStart(row, $event)"
          @dragend="onTreeRowDragEnd"
        >
          <ChevronRight
            v-if="row.isDirectory"
            class="workspace-file-tree-row__chevron"
            :class="{ 'rotate-90': row.isExpanded }"
            aria-hidden="true"
          />
          <span
            v-else
            class="workspace-file-tree-row__chevron workspace-file-tree-row__chevron--spacer"
            aria-hidden="true"
          ></span>
          <WorkspaceTreeEntryIcon :path="row.path" :isDirectory="row.isDirectory" :isExpanded="row.isExpanded" />
          <span class="workspace-file-tree-row__label">{{ row.label }}</span>
          <span v-if="treeRowMetaText(row)" class="workspace-file-tree-row__meta">
            {{ treeRowMetaText(row) }}
          </span>
          <span
            v-else-if="row.gitStatus"
            class="workspace-file-tree-row__git"
            :data-git-status="row.gitStatus.code"
            :title="gitStatusTitle(row)"
            aria-hidden="true"
          >
            {{ row.gitStatus.code }}
          </span>
        </button>

        <div
          v-else
          class="workspace-file-tree-message"
          :class="{
            'is-error': row.tone === 'error',
            'is-dim': row.tone === 'dim',
          }"
          :style="treeMessageStyle(row)"
        >
          {{ row.text }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronRight } from "lucide-vue-next";
import WorkspaceTreeEntryIcon from "./WorkspaceTreeEntryIcon.vue";
import { useWorkspaceFilesStore } from "../../../stores/workspaceFiles.store";
import { basenameFromPath } from "../../../domain/workspaceFiles";
import { normalizeAbsoluteFsPath } from "../../../domain/workspacePath";
import { writeWorkspaceFileDragData } from "../../../domain/workspaceFileDrag";
import type { WorkspaceGitStatusEntry } from "@codenexus/shared/ipc/contracts";

const props = withDefaults(
  defineProps<{
    filterText?: string;
    allowContextMenu?: boolean;
    showSystemFiles?: boolean;
  }>(),
  {
    filterText: "",
    allowContextMenu: false,
    showSystemFiles: false,
  }
);

const emit = defineEmits<{
  fileContextMenu: [path: string, event: MouseEvent];
}>();

const workspaceFilesStore = useWorkspaceFilesStore();
const { t } = useI18n();
const treeSurfaceRef = ref<HTMLElement | null>(null);
const draggingTreePath = ref("");

type TreeRow =
  | {
      kind: "entry";
      key: string;
      path: string;
      label: string;
      depth: number;
      isDirectory: boolean;
      isExpanded: boolean;
      isLoading: boolean;
      isActiveFile: boolean;
      isSelectedDirectory: boolean;
      gitStatus: WorkspaceGitStatusEntry | null;
    }
  | {
      kind: "message";
      key: string;
      path: string;
      depth: number;
      text: string;
      tone: "dim" | "error";
    };

const normalizedFilter = computed(() =>
  String(props.filterText ?? "")
    .trim()
    .toLowerCase()
);
const hasFilter = computed(() => normalizedFilter.value.length > 0);

function includesFilter(path: string, label: string): boolean {
  if (!hasFilter.value) return true;
  const q = normalizedFilter.value;
  return (
    String(path ?? "")
      .toLowerCase()
      .includes(q) ||
    String(label ?? "")
      .toLowerCase()
      .includes(q)
  );
}

const treeRows = computed<TreeRow[]>(() => {
  const workspace = normalizeAbsoluteFsPath(workspaceFilesStore.workspacePath);
  if (!workspace) return [];

  const appendDirectory = (path: string, label: string, depth: number): TreeRow[] => {
    const normalizedPath = normalizeAbsoluteFsPath(path);
    const isExpandedByStore = workspaceFilesStore.isDirectoryExpanded(normalizedPath);
    const isExpanded = hasFilter.value ? true : isExpandedByStore;
    const isLoading = workspaceFilesStore.isDirectoryLoading(normalizedPath);
    const isSelectedDirectory = normalizeAbsoluteFsPath(workspaceFilesStore.directoryPath) === normalizedPath;
    const isRoot = depth === 0;
    const matchedSelf = includesFilter(normalizedPath, label);
    const childRows: TreeRow[] = [];
    let hasMatchedChildren = false;

    if (isExpanded) {
      const errorText = workspaceFilesStore.directoryErrorByPath(normalizedPath);
      if (errorText && (!hasFilter.value || includesFilter(normalizedPath, errorText))) {
        childRows.push({
          kind: "message",
          key: `direrr:${normalizedPath}`,
          path: normalizedPath,
          depth: depth + 1,
          text: errorText,
          tone: "error",
        });
        hasMatchedChildren = true;
      }

      const entries = workspaceFilesStore.directoryEntriesByPath(normalizedPath);
      if (entries.length === 0 && !isLoading && !errorText && !hasFilter.value) {
        childRows.push({
          kind: "message",
          key: `dirempty:${normalizedPath}`,
          path: normalizedPath,
          depth: depth + 1,
          text: t("workspaceFiles.emptyDirectory"),
          tone: "dim",
        });
      }

      for (const entry of entries) {
        if (!props.showSystemFiles && [".git", "node_modules", ".DS_Store", ".pnpm-store"].includes(entry.fileName))
          continue;
        if (entry.isDirectory) {
          const nestedRows = appendDirectory(entry.path, entry.fileName, depth + 1);
          if (nestedRows.length > 0) {
            childRows.push(...nestedRows);
            hasMatchedChildren = true;
          }
          continue;
        }

        if (!includesFilter(entry.path, entry.fileName)) continue;
        childRows.push({
          kind: "entry",
          key: `file:${entry.path}`,
          path: entry.path,
          label: entry.fileName,
          depth: depth + 1,
          isDirectory: false,
          isExpanded: false,
          isLoading: false,
          isActiveFile:
            normalizeAbsoluteFsPath(workspaceFilesStore.activeFilePath) === normalizeAbsoluteFsPath(entry.path),
          isSelectedDirectory: false,
          gitStatus: workspaceFilesStore.gitStatusForPath(entry.path),
        });
        hasMatchedChildren = true;
      }
    }

    if (hasFilter.value && !isRoot && !matchedSelf && !hasMatchedChildren) return [];

    const rows: TreeRow[] = [
      {
        kind: "entry",
        key: `dir:${normalizedPath}`,
        path: normalizedPath,
        label,
        depth,
        isDirectory: true,
        isExpanded,
        isLoading,
        isActiveFile: false,
        isSelectedDirectory,
        gitStatus: workspaceFilesStore.gitStatusForDirectory(normalizedPath),
      },
    ];
    if (isExpanded) rows.push(...childRows);
    return rows;
  };

  const rows = appendDirectory(workspace, basenameFromPath(workspace) || workspace, 0);
  if (hasFilter.value && rows.length === 1) {
    rows.push({
      kind: "message",
      key: `filter-empty:${workspace}`,
      path: workspace,
      depth: 1,
      text: t("workspaceFiles.noFileMatches"),
      tone: "dim",
    });
  }
  return rows;
});

const maxTreeDepth = computed(() =>
  treeRows.value.reduce((maxDepth, row) => (row.depth > maxDepth ? row.depth : maxDepth), 0)
);

const horizontalDepthOverflow = computed(() => Math.max(0, maxTreeDepth.value - 8));

const treeContentStyle = computed(() => ({
  minWidth: horizontalDepthOverflow.value > 0 ? `calc(100% + ${horizontalDepthOverflow.value * 14}px)` : "100%",
}));

const treeRowClass = (row: Extract<TreeRow, { kind: "entry" }>) => ({
  "is-root": row.depth === 0,
  "is-directory": row.isDirectory,
  "is-file": !row.isDirectory,
  "is-active-file": row.isActiveFile,
  "is-selected-directory": row.isSelectedDirectory,
  "is-deleting": workspaceFilesStore.isFileDeleting(row.path),
  "is-drag-source": draggingTreePath.value === normalizeAbsoluteFsPath(row.path),
});

const treeRowStyle = (row: Extract<TreeRow, { kind: "entry" }>) => ({
  paddingLeft: `${10 + row.depth * 14}px`,
});

const treeMessageStyle = (row: Extract<TreeRow, { kind: "message" }>) => ({
  paddingLeft: `${24 + row.depth * 14}px`,
});

const treeRowMetaText = (row: Extract<TreeRow, { kind: "entry" }>) => {
  if (workspaceFilesStore.isFileDeleting(row.path)) return t("workspaceFiles.deleting");
  if (row.isLoading) return t("workspaceFiles.loading");
  return "";
};

const gitStatusTitle = (row: Extract<TreeRow, { kind: "entry" }>) => {
  if (!row.gitStatus) return "";
  return `${row.gitStatus.code} ${row.gitStatus.relativePath}`;
};

const treeRowTitle = (row: Extract<TreeRow, { kind: "entry" }>) => {
  const gitText = gitStatusTitle(row);
  return gitText ? `${row.label}\n${row.path}\n${gitText}` : `${row.label}\n${row.path}`;
};

const onOpenTreeRow = (row: Extract<TreeRow, { kind: "entry" }>) => {
  if (workspaceFilesStore.isFileDeleting(row.path)) return;
  if (row.isDirectory) {
    if (hasFilter.value) return;
    void workspaceFilesStore.toggleDirectoryExpanded(row.path);
    return;
  }
  void workspaceFilesStore.openFile(row.path);
};

const onTreeRowContextMenu = (row: Extract<TreeRow, { kind: "entry" }>, event: MouseEvent) => {
  if (!props.allowContextMenu || row.isDirectory || workspaceFilesStore.isFileDeleting(row.path)) return;
  event.preventDefault();
  event.stopPropagation();
  emit("fileContextMenu", normalizeAbsoluteFsPath(row.path), event);
};

const onTreeRowDragStart = (row: Extract<TreeRow, { kind: "entry" }>, event: DragEvent) => {
  if (workspaceFilesStore.isFileDeleting(row.path)) {
    event.preventDefault();
    return;
  }
  draggingTreePath.value = normalizeAbsoluteFsPath(row.path);
  writeWorkspaceFileDragData(event.dataTransfer, row.path, {
    kind: row.isDirectory ? "directory" : "file",
  });
};

const onTreeRowDragEnd = () => {
  draggingTreePath.value = "";
};

const onTreeSurfaceWheel = (event: WheelEvent) => {
  const surface = treeSurfaceRef.value;
  if (!surface || !event.shiftKey || event.deltaY === 0) return;
  const maxScrollLeft = surface.scrollWidth - surface.clientWidth;
  if (maxScrollLeft <= 0) return;
  event.preventDefault();
  surface.scrollLeft = Math.max(0, Math.min(maxScrollLeft, surface.scrollLeft + event.deltaY));
};

function scrollActiveRowIntoView() {
  const targetPath = normalizeAbsoluteFsPath(workspaceFilesStore.activeFilePath);
  const surface = treeSurfaceRef.value;
  if (!targetPath || !surface) return;
  const row = surface.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(targetPath)}"]`);
  row?.scrollIntoView({ block: "nearest" });
}

onMounted(() => {
  void workspaceFilesStore.ensureReady(false);
});

watch(
  () =>
    [
      workspaceFilesStore.activeFilePath,
      treeRows.value.length,
      workspaceFilesStore.directoryPath,
      hasFilter.value,
    ] as const,
  () => {
    nextTick(() => {
      scrollActiveRowIntoView();
    });
  },
  { flush: "post" }
);
function onTreeKeydown(event: KeyboardEvent) {
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const rows = Array.from(treeSurfaceRef.value?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') || []);
  const current = event.target as HTMLButtonElement;
  const index = rows.indexOf(current);
  if (index < 0) return;
  event.preventDefault();
  if (event.key === "ArrowRight" && current.getAttribute("aria-expanded") === "false") {
    current.click();
    return;
  }
  if (event.key === "ArrowLeft" && current.getAttribute("aria-expanded") === "true") {
    current.click();
    return;
  }
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : Math.max(0, Math.min(rows.length - 1, index + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1)));
  rows[next]?.focus();
}
</script>
