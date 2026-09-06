<template>
  <div class="topbar-wrap">
    <header class="topbar">
      <div class="topbar-left row">
        <TopBarWorkspaceButton />
        <details ref="viewMenuRef" class="topbar-view-menu" @keydown.esc="closeViewMenu">
          <summary class="topbar-view-trigger">
            <span>{{ t("topbar.mainView") }}</span
            ><ChevronDown aria-hidden="true" />
          </summary>
          <div class="topbar-view-options">
            <button
              class="topbar-mainview-btn"
              :class="{ 'is-active': appShellStore.mainView === 'chat' }"
              type="button"
              :aria-label="t('topbar.chat')"
              @click="onSetMainView('chat')"
            >
              <MessageSquare class="topbar-mainview-icon" aria-hidden="true" />
              <span>{{ t("topbar.chat") }}</span>
            </button>
            <button
              class="topbar-mainview-btn"
              :class="{ 'is-active': appShellStore.mainView === 'image' }"
              type="button"
              :aria-label="t('topbar.image')"
              @click="onSetMainView('image')"
            >
              <ImageIcon class="topbar-mainview-icon" aria-hidden="true" />
              <span>{{ t("topbar.image") }}</span>
            </button>
            <button
              class="topbar-mainview-btn"
              :class="{ 'is-active': appShellStore.mainView === 'flowchart' }"
              type="button"
              :aria-label="t('topbar.flowchart')"
              @click="onSetMainView('flowchart')"
            >
              <Workflow class="topbar-mainview-icon" aria-hidden="true" />
              <span>{{ t("topbar.flowchart") }}</span>
            </button>
            <button
              class="topbar-mainview-btn"
              :class="{ 'is-active': appShellStore.mainView === 'paper' }"
              type="button"
              :aria-label="t('topbar.paper')"
              @click="onSetMainView('paper')"
            >
              <BookOpen class="topbar-mainview-icon" aria-hidden="true" />
              <span>{{ t("topbar.paper") }}</span>
            </button>
          </div>
        </details>
      </div>

      <div class="topbar-center-stack">
        <div class="topbar-task-title" :title="taskTitle">{{ taskTitle }}</div>
        <TopBarGoalSummary />
        <TopBarPlanSummary />
      </div>

      <div class="topbar-right-stack">
        <div class="row topbar-controls topbar-controls--sleek">
          <div
            v-if="hasWorkspace && !appShellStore.settingsOpen && appShellStore.mainView === 'chat'"
            ref="diffMenuRef"
            class="relative"
          >
            <TopBarTurnDiffMenu :open="diffOpen" @toggle="diffOpen = !diffOpen" @close="diffOpen = false" />
          </div>
          <div class="control-group control-group-panes" :aria-label="t('topbar.panels')">
            <button
              id="btn-toggle-thread-pane"
              class="btn-icon"
              :class="{ 'is-active': appShellStore.leftSidebarVisible }"
              type="button"
              :disabled="appShellStore.settingsOpen || appShellStore.mainView === 'flowchart'"
              :aria-label="threadPaneTitle"
              :aria-pressed="appShellStore.leftSidebarVisible ? 'true' : 'false'"
              @click="onToggleThreadPane"
            >
              <PanelLeftClose v-if="appShellStore.leftSidebarVisible" aria-hidden="true" />
              <PanelLeftOpen v-else aria-hidden="true" />
            </button>
            <button
              id="btn-toggle-files-pane"
              class="btn-icon"
              :class="{ 'is-active': filesPaneVisible }"
              type="button"
              :disabled="!hasWorkspace || appShellStore.settingsOpen"
              :aria-label="filesPaneTitle"
              :aria-pressed="filesPaneVisible ? 'true' : 'false'"
              @click="onToggleFilesPane"
            >
              <PanelRightClose v-if="filesPaneVisible" aria-hidden="true" />
              <PanelRightOpen v-else aria-hidden="true" />
            </button>
            <button
              id="btn-open-settings"
              class="btn-icon"
              :class="{ 'is-active': appShellStore.settingsOpen }"
              type="button"
              :aria-label="t('topbar.openSettings')"
              :aria-pressed="appShellStore.settingsOpen ? 'true' : 'false'"
              @click="onOpenSettings"
            >
              <Settings aria-hidden="true" />
            </button>
          </div>
          <div class="topbar-control-divider" aria-hidden="true"></div>
          <div class="control-group control-group-actions">
            <TopBarAccountStatus />
            <TopBarUpdateNotice />
            <TopBarThemeSwitch />
          </div>

          <div class="control-group control-group-window">
            <TopBarWindowControls />
          </div>
        </div>
      </div>
    </header>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronDown,
  Image as ImageIcon,
  BookOpen,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Workflow,
} from "lucide-vue-next";
import TopBarWorkspaceButton from "./topbar/TopBarWorkspaceButton.vue";
import TopBarGoalSummary from "./topbar/TopBarGoalSummary.vue";
import TopBarPlanSummary from "./topbar/TopBarPlanSummary.vue";
import TopBarThemeSwitch from "./topbar/TopBarThemeSwitch.vue";
import TopBarAccountStatus from "./topbar/TopBarAccountStatus.vue";
import TopBarUpdateNotice from "./topbar/TopBarUpdateNotice.vue";
import TopBarWindowControls from "./topbar/TopBarWindowControls.vue";
import TopBarTurnDiffMenu from "./topbar/TopBarTurnDiffMenu.vue";
import { useAppShellStore } from "../../stores/appShell.store";
import { useThreadStore } from "../../stores/thread.store";
import { useRuntimeStore } from "../../stores/runtime.store";
import { useWorkspaceFilesStore } from "../../stores/workspaceFiles.store";
import { isFeatureMainView } from "../../features/registry";
import "./topbar/topbar.css";
import type { MainView } from "@codenexus/shared/localSettings";

const appShellStore = useAppShellStore();
const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const workspaceFilesStore = useWorkspaceFilesStore();
const threadStore = useThreadStore();
const taskTitle = computed(() => {
  if (appShellStore.settingsOpen) return t("settings.pageAria");
  if (appShellStore.mainView !== "chat") return t(`topbar.${appShellStore.mainView}`);
  return (
    threadStore.threadHistory.find((item) => item.id === runtimeStore.currentThreadId)?.title ||
    t("threadHistory.newThread")
  );
});
const diffMenuRef = ref<HTMLElement | null>(null);
const diffOpen = ref(false);
const viewMenuRef = ref<HTMLDetailsElement | null>(null);
function closeViewMenu() {
  if (viewMenuRef.value) viewMenuRef.value.open = false;
}
function closeViewOutside(event: PointerEvent) {
  if (!viewMenuRef.value?.contains(event.target as Node)) closeViewMenu();
}
function closeDiffOutside(event: PointerEvent) {
  if (!diffMenuRef.value?.contains(event.target as Node)) diffOpen.value = false;
}
function closeDiffOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape") {
    diffOpen.value = false;
    closeViewMenu();
  }
}
onMounted(() => {
  document.addEventListener("pointerdown", closeDiffOutside);
  document.addEventListener("pointerdown", closeViewOutside);
  document.addEventListener("keydown", closeDiffOnEscape);
});
watch(
  () => [runtimeStore.workspacePath, appShellStore.settingsOpen, appShellStore.mainView],
  () => {
    diffOpen.value = false;
  }
);

const hasWorkspace = computed(() => Boolean(String(runtimeStore.workspacePath ?? "").trim()));
const filesPaneVisible = computed(
  () =>
    hasWorkspace.value &&
    !appShellStore.settingsOpen &&
    appShellStore.mainView === "chat" &&
    appShellStore.filesSidebarVisible
);
const threadPaneTitle = computed(() => {
  if (appShellStore.settingsOpen) return t("topbar.threadPanelHiddenInSettings");
  if (appShellStore.mainView === "image") {
    return appShellStore.leftSidebarVisible
      ? t("topbar.closeImageWorkspacePanel")
      : t("topbar.openImageWorkspacePanel");
  }
  if (appShellStore.mainView === "flowchart") return t("topbar.threadPanelHiddenInFlowchart");
  if (appShellStore.mainView === "paper") {
    return appShellStore.leftSidebarVisible
      ? t("topbar.closePaperWorkspacePanel")
      : t("topbar.openPaperWorkspacePanel");
  }
  return appShellStore.leftSidebarVisible ? t("topbar.closeThreadPanel") : t("topbar.openThreadPanel");
});
const filesPaneTitle = computed(() => {
  if (!hasWorkspace.value) return t("topbar.chooseWorkspaceBeforeFiles");
  if (appShellStore.settingsOpen) return t("topbar.filesPanelHiddenInSettings");
  if (appShellStore.mainView === "image") return t("topbar.filesPanelHiddenInImage");
  if (appShellStore.mainView === "flowchart") return t("topbar.filesPanelHiddenInFlowchart");
  if (appShellStore.mainView === "paper") return t("topbar.filesPanelHiddenInPaper");
  return filesPaneVisible.value ? t("topbar.closeFilesPanel") : t("topbar.openFilesPanel");
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeDiffOutside);
  document.removeEventListener("pointerdown", closeViewOutside);
  document.removeEventListener("keydown", closeDiffOnEscape);
});

function onSetMainView(next: MainView) {
  closeViewMenu();
  if (isFeatureMainView(next)) {
    appShellStore.openFeatureWorkbench(next);
    return;
  }
  appShellStore.setMainView(next);
  if (appShellStore.settingsOpen) appShellStore.closeSettings();
}

function onToggleThreadPane() {
  if (appShellStore.settingsOpen || appShellStore.mainView === "flowchart") return;
  appShellStore.toggleLeftSidebarVisible();
}

async function onToggleFilesPane() {
  if (!hasWorkspace.value || appShellStore.settingsOpen || appShellStore.mainView !== "chat") return;
  if (filesPaneVisible.value) {
    const confirmed = await workspaceFilesStore.prepareToHidePane();
    if (!confirmed) return;
    appShellStore.setFilesSidebarVisible(false);
    return;
  }
  appShellStore.setFilesSidebarVisible(true);
}

function onOpenSettings() {
  appShellStore.openSettings("global");
}
</script>
