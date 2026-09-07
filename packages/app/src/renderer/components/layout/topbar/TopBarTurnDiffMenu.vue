<template>
  <div class="topbar-single-switch" :class="{ 'is-open': props.open }">
    <span class="topbar-single-switch-thumb" aria-hidden="true"></span>
    <button
      id="btn-topbar-turn-diff"
      class="topbar-single-switch-option"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="props.open ? 'true' : 'false'"
      :aria-label="t('topbarExtra.fileChanges')"
      @click.stop="emit('toggle')"
    >
      <GitCompare aria-hidden="true" />
      <span class="topbar-right-switch-label">{{ t("topbarExtra.diff") }}</span>
    </button>
  </div>

  <PanelDialog :open="props.open" :title="diffHeading" @close="emit('close')">
    <div class="review-toolbar">
      <span>{{ locale.startsWith("zh") ? "文件变更" : "File Changes" }}</span>
      <button type="button" class="btn-mini" :disabled="refreshing" @click="refreshDiff">
        {{ t("common.refresh") }}
      </button>
      <button
        v-if="workspaceFilesStore.gitDiff.diffText && currentTurnDiffText"
        type="button"
        class="btn-mini"
        @click="preferNative = !preferNative"
      >
        {{ t(showWorkspaceDiff ? "topbarExtra.showNativeDiff" : "topbarExtra.showWorkspaceDiff") }}
      </button>
    </div>
    <StatusIndicator v-if="refreshing" state="loading" />
    <p v-if="workspaceFilesStore.gitDiff.status === 'not_git'" class="review-note">{{ t("topbarExtra.nonGitDiff") }}</p>
    <p v-if="workspaceFilesStore.gitDiff.status === 'unavailable'" class="review-note">
      <StatusIndicator
        state="unavailable"
        :label="
          locale.startsWith('zh')
            ? '无法读取工作区变更，请刷新重试。'
            : 'Workspace changes unavailable. Try refreshing.'
        "
      />
    </p>
    <details v-if="showWorkspaceDiff && workspaceFilesStore.gitDiff.skipped" class="review-skipped">
      <summary>{{ t("topbarExtra.diffSkipped", { count: workspaceFilesStore.gitDiff.skipped }) }}</summary>
      <p>
        {{
          locale.startsWith("zh")
            ? "当前预览未包含这些文件。差异服务只返回跳过数量，暂未提供逐文件名称和原因。可在文件树查看项目文件。"
            : "These files are not included in the preview. The diff service returns a count, but no per-file names or reasons. Browse the project in Files."
        }}
      </p>
      <button type="button" class="btn-mini" @click="openFiles">
        {{ locale.startsWith("zh") ? "查看项目文件" : "Browse Files" }}
      </button>
    </details>
    <p v-if="!displayDiffText && !refreshing" class="review-note">{{ t("topbarExtra.noDiff") }}</p>
    <template v-if="displayDiffText"
      ><TurnDiffSummaryCard :diffText="displayDiffText" /><UnifiedDiffViewer
        :diffText="displayDiffText"
        :animateUpdates="false"
    /></template>
  </PanelDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { selectReviewDiff } from "../../../features/timeline/renderModel/diff";
import PanelDialog from "../../ui/PanelDialog.vue";
import StatusIndicator from "../../ui/StatusIndicator.vue";
import { useAppShellStore } from "../../../stores/appShell.store";
import { GitCompare } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import TurnDiffSummaryCard from "../../timeline/cards/TurnDiffSummaryCard.vue";
import UnifiedDiffViewer from "../../timeline/cards/UnifiedDiffViewer.vue";
import { useWorkspaceFilesStore } from "../../../stores/workspaceFiles.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useThreadStore } from "../../../stores/thread.store";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle"): void;
  (e: "close"): void;
}>();

const runtimeStore = useRuntimeStore();
const threadStore = useThreadStore();
const workspaceFilesStore = useWorkspaceFilesStore();
const preferNative = ref(false);
const refreshing = ref(false);
const shell = useAppShellStore();
async function refreshDiff() {
  refreshing.value = true;
  try {
    await workspaceFilesStore.refreshGitDiff();
  } finally {
    refreshing.value = false;
  }
}
function openFiles() {
  shell.setFilesSidebarVisible(true, { save: false });
  emit("close");
}
watch(
  () => props.open,
  (open) => {
    if (open) void refreshDiff();
  }
);
watch(
  () => runtimeStore.workspacePath,
  () => {
    preferNative.value = false;
  }
);
const { t, locale } = useI18n();

const currentTurnDiff = computed(() => {
  const threadId = String(threadStore.currentThreadId || runtimeStore.timelineKey || "").trim();
  if (!threadId) return { turnId: "", diffText: "" };

  const diffMap = threadStore.turnDiffByThread.get(threadId) ?? null;
  if (!diffMap || diffMap.size === 0) return { turnId: "", diffText: "" };

  const planTurnId = String(threadStore.currentTurnPlan?.turnId ?? "").trim();
  const activeTurnId = String(threadStore.activeTurnIdByThread.get(threadId) ?? "").trim();

  const pickForTurn = (turnId: string) => {
    if (!turnId) return null;
    const diffText = diffMap.get(turnId) ?? "";
    if (!String(diffText ?? "").trim()) return null;
    return { turnId, diffText };
  };

  const direct = pickForTurn(planTurnId) ?? pickForTurn(activeTurnId);
  if (direct) return direct;

  const completed = threadStore.completedTurnsByThread.get(threadId) ?? [];
  for (let i = completed.length - 1; i >= 0; i -= 1) {
    const diffText = String(completed[i]?.diffText ?? "");
    if (!diffText.trim()) continue;
    const turnId = String(completed[i]?.turnId ?? "").trim();
    if (!turnId) continue;
    return { turnId, diffText };
  }

  let lastTurnId = "";
  let lastDiffText = "";
  for (const [turnId, diffText] of diffMap.entries()) {
    if (!String(diffText ?? "").trim()) continue;
    lastTurnId = String(turnId ?? "").trim();
    lastDiffText = String(diffText ?? "");
  }
  return { turnId: lastTurnId, diffText: lastDiffText };
});

const currentTurnDiffText = computed(() => String(currentTurnDiff.value?.diffText ?? ""));
const selectedDiff = computed(() =>
  selectReviewDiff(workspaceFilesStore.gitDiff, currentTurnDiffText.value, preferNative.value)
);
const showWorkspaceDiff = computed(() => selectedDiff.value.isWorkspace);
const displayDiffText = computed(() => selectedDiff.value.diffText);
const diffHeading = computed(() =>
  t(
    showWorkspaceDiff.value
      ? "topbarExtra.workspaceDiff"
      : currentTurnDiffText.value
        ? "topbarExtra.turnDiff"
        : "topbarExtra.fileChanges"
  )
);
</script>
