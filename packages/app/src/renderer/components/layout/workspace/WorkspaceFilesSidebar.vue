<template>
  <aside class="sidebar sidebar-right workspace-files-sidebar">
    <div class="workspace-files-heading">
      <span>{{ locale.startsWith("zh") ? "工作区" : "Workspace" }}</span
      ><button
        class="btn-icon"
        type="button"
        :aria-label="t('common.close')"
        @click="shell.setFilesSidebarVisible(false, { save: false })"
      >
        <X aria-hidden="true" />
      </button>
    </div>
    <label class="workspace-file-search"
      ><Search aria-hidden="true" /><input
        v-model="filterText"
        type="search"
        :aria-label="locale.startsWith('zh') ? '筛选已加载文件' : 'Filter loaded files'"
        :placeholder="locale.startsWith('zh') ? '筛选已加载文件…' : 'Filter loaded files…'"
    /></label>
    <div class="workspace-files-shell">
      <div class="workspace-files-body workspace-files-body--tree-only">
        <section class="workspace-files-section workspace-files-section--tree">
          <WorkspaceFileTreeView
            :filter-text="filterText"
            :show-system-files="showSystemFiles"
            allow-context-menu
            @file-context-menu="onFileContextMenu"
          />
        </section>
      </div>
    </div>
    <label class="workspace-files-ignored"
      ><input v-model="showSystemFiles" type="checkbox" />{{
        locale.startsWith("zh") ? "显示系统与依赖文件" : "Show system & dependency files"
      }}</label
    >
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="workspace-file-context-menu"
        :style="contextMenuStyle"
        role="menu"
        :aria-label="t('workspaceFiles.fileActions')"
        @click.stop
        @contextmenu.prevent
      >
        <button
          class="workspace-file-context-menu__item is-danger"
          type="button"
          role="menuitem"
          :disabled="workspaceFilesStore.isFileDeleting(contextMenu.path)"
          @click="onDeleteContextFile"
        >
          <Trash2 class="workspace-file-context-menu__icon" aria-hidden="true" />
          <span>{{ t("workspaceFiles.deleteFile") }}</span>
        </button>
      </div>
    </Teleport>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Search, Trash2, X } from "lucide-vue-next";
import { useAppShellStore } from "../../../stores/appShell.store";
import WorkspaceFileTreeView from "./WorkspaceFileTreeView.vue";
import { useWorkspaceFilesStore } from "../../../stores/workspaceFiles.store";
import { normalizeAbsoluteFsPath } from "../../../domain/workspacePath";

const workspaceFilesStore = useWorkspaceFilesStore();
const { t, locale } = useI18n();
const filterText = ref("");
const showSystemFiles = ref(false);
const shell = useAppShellStore();
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  path: "",
});

const contextMenuStyle = computed(() => ({
  left: `${contextMenu.value.x}px`,
  top: `${contextMenu.value.y}px`,
}));

const closeContextMenu = () => {
  if (!contextMenu.value.visible) return;
  contextMenu.value = {
    visible: false,
    x: 0,
    y: 0,
    path: "",
  };
};

const onFileContextMenu = (path: string, event: MouseEvent) => {
  const menuWidth = 176;
  const menuHeight = 44;
  const viewportPadding = 8;
  contextMenu.value = {
    visible: true,
    x: Math.max(viewportPadding, Math.min(event.clientX, window.innerWidth - menuWidth - viewportPadding)),
    y: Math.max(viewportPadding, Math.min(event.clientY, window.innerHeight - menuHeight - viewportPadding)),
    path: normalizeAbsoluteFsPath(path),
  };
};

const onDeleteContextFile = async () => {
  const path = normalizeAbsoluteFsPath(contextMenu.value.path);
  closeContextMenu();
  if (!path) return;
  await workspaceFilesStore.deleteWorkspaceFile(path);
};

function onWindowPointerDown(event: PointerEvent) {
  const target = event.target;
  if (target instanceof Element && target.closest(".workspace-file-context-menu")) return;
  closeContextMenu();
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closeContextMenu();
}

onMounted(() => {
  window.addEventListener("pointerdown", onWindowPointerDown, true);
  window.addEventListener("keydown", onWindowKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDown, true);
  window.removeEventListener("keydown", onWindowKeydown, true);
});
</script>
