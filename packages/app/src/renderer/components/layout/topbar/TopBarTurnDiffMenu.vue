<template>
  <div class="topbar-single-switch" :class="{ 'is-open': props.open }">
    <span class="topbar-single-switch-thumb" aria-hidden="true"></span>
    <button
      id="btn-topbar-turn-diff"
      class="topbar-single-switch-option"
      type="button"
      aria-haspopup="menu"
      :aria-expanded="props.open ? 'true' : 'false'"
      :aria-label="t('topbarExtra.fileChanges')"
      @click.stop="emit('toggle')"
    >
      <GitCompare aria-hidden="true" />
      <span class="topbar-right-switch-label">{{ t("topbarExtra.diff") }}</span>
    </button>
  </div>

  <Transition name="topbar-fly">
    <div v-if="props.open" class="topbar-menu-shell topbar-menu-shell--turn-diff" @click.stop>
      <div class="topbar-dropdown topbar-menu app-scrollbar" role="menu" :aria-label="diffHeading">
        <div class="topbar-menu-section">
          <div class="topbar-menu-heading">
            {{ diffHeading }}
          </div>
          <button
            v-if="workspaceFilesStore.gitDiff.diffText && currentTurnDiffText"
            type="button"
            class="topbar-menu-note"
            @click="preferNative = !preferNative"
          >
            {{ t(showWorkspaceDiff ? "topbarExtra.showNativeDiff" : "topbarExtra.showWorkspaceDiff") }}
          </button>
          <div v-if="workspaceFilesStore.gitDiff.status === 'not_git'" class="topbar-menu-note">
            {{ t("topbarExtra.nonGitDiff") }}
          </div>
          <div v-if="showWorkspaceDiff && workspaceFilesStore.gitDiff.skipped" class="topbar-menu-note">
            {{ t("topbarExtra.diffSkipped", { count: workspaceFilesStore.gitDiff.skipped }) }}
          </div>
          <div v-if="!displayDiffText" class="topbar-menu-note">{{ t("topbarExtra.noDiff") }}</div>
          <div v-else>
            <TurnDiffSummaryCard :diffText="displayDiffText" />
            <UnifiedDiffViewer :diffText="displayDiffText" :animateUpdates="false" />
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
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
watch(
  () => props.open,
  (open) => {
    if (open) void workspaceFilesStore.refreshGitDiff();
  }
);
watch(
  () => runtimeStore.workspacePath,
  () => {
    preferNative.value = false;
  }
);
const { t } = useI18n();

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
const showWorkspaceDiff = computed(
  () =>
    workspaceFilesStore.gitDiff.status === "ok" &&
    (workspaceFilesStore.gitDiff.diffText || !currentTurnDiffText.value) &&
    (!preferNative.value || !currentTurnDiffText.value)
);
const displayDiffText = computed(() =>
  showWorkspaceDiff.value ? workspaceFilesStore.gitDiff.diffText : currentTurnDiffText.value
);
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

<style scoped>
.topbar-menu-shell--turn-diff {
  left: auto;
  right: 0;
  width: min(600px, calc(100vw - 24px));
  --topbar-dropdown-max-h: min(70vh, 600px);
}
</style>
