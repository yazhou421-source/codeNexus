<template>
  <section class="settings-card" :aria-label="t('settingsUpdate.aria')">
    <header class="settings-card-head">
      <div class="settings-card-title">{{ t("settingsUpdate.title") }}</div>
      <div class="row settings-update-actions">
        <button class="btn-mini" type="button" :disabled="actionDisabled" @click="onPrimaryAction">
          {{ primaryActionLabel }}
        </button>
      </div>
    </header>

    <div class="settings-card-body">
      <div class="settings-grid">
        <div class="settings-row">
          <span class="context-label dim">{{ t("settingsUpdate.currentVersion") }}</span>
          <span class="mono">{{ updateState.currentVersion }}</span>
        </div>

        <div class="settings-row">
          <span class="context-label dim">{{ t("settingsUpdate.latestVersion") }}</span>
          <span class="mono">{{ updateState.latestVersion || t("settingsUpdate.unknown") }}</span>
        </div>

        <div class="settings-row">
          <span class="context-label dim">{{ t("settingsUpdate.status") }}</span>
          <span class="mono">{{ statusText }}</span>
        </div>

        <div v-if="updateState.status === 'downloading'" class="settings-update-progress" aria-live="polite">
          <div
            class="settings-update-progress-track"
            role="progressbar"
            :aria-valuenow="progressPercent"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="t('settingsUpdate.downloading')"
          >
            <div class="settings-update-progress-fill" :style="{ width: `${progressPercent}%` }"></div>
          </div>
          <div class="mono dim text-[12px]">{{ progressText }}</div>
        </div>

        <div v-if="actionError" role="alert">{{ actionError }}</div>
        <div v-if="updateState.checkedAt" class="dim text-[12px]">
          {{ t("settingsUpdate.checkedAt") }}: {{ new Date(updateState.checkedAt).toLocaleString() }}
        </div>
        <div v-if="updateState.errorMessage" class="dim text-[12px] leading-[1.25]">
          {{ updateState.errorMessage }}
        </div>

        <div v-if="releaseSummary" class="dim text-[12px] leading-[1.35] whitespace-pre-line">
          {{ releaseSummary }}
        </div>

        <div class="dim text-[12px] leading-[1.25]">{{ t("settingsUpdate.description") }}</div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AppUpdateSnapshot } from "@codenexus/shared/ipc/contracts";

const { t } = useI18n();

const DEFAULT_STATE: AppUpdateSnapshot = {
  status: "idle",
  currentVersion: "0.0.0",
  latestVersion: null,
  releaseName: null,
  releaseNotes: null,
  updateAvailable: false,
  downloaded: false,
  progress: null,
  errorMessage: null,
  checkedAt: null,
  isPackaged: false,
};

const updateState = reactive<AppUpdateSnapshot>({ ...DEFAULT_STATE });
const actionRunning = ref(false);
const actionError = ref("");
let offUpdateState: (() => void) | null = null;

const applyState = (next: AppUpdateSnapshot) => {
  Object.assign(updateState, next);
};

const statusText = computed(() => t(`settingsUpdate.statuses.${updateState.status}`));

const progressPercent = computed(() => {
  const percent = Number(updateState.progress?.percent ?? 0);
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
});

const progressText = computed(() => {
  const p = updateState.progress;
  const amount =
    p && p.total > 0 ? ` · ${(p.transferred / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB` : "";
  return t("settingsUpdate.progress", { percent: progressPercent.value }) + amount;
});

const releaseSummary = computed(() => {
  const parts = [updateState.releaseName, updateState.releaseNotes].filter(Boolean);
  return parts.join("\n\n");
});

const primaryActionLabel = computed(() => {
  if (actionRunning.value) return t("settingsUpdate.processing");
  if (updateState.status === "checking") return t("settingsUpdate.checking");
  if (updateState.status === "downloading") return t("settingsUpdate.downloading");
  if (updateState.updateAvailable && !updateState.downloaded) return t("settingsUpdate.download");
  if (updateState.status === "downloaded") return t("settingsUpdate.install");
  return t("settingsUpdate.check");
});

const actionDisabled = computed(() => {
  if (actionRunning.value) return true;
  if (!updateState.isPackaged) return true;
  return updateState.status === "checking" || updateState.status === "downloading";
});

const onPrimaryAction = async () => {
  if (actionDisabled.value) return;
  actionRunning.value = true;
  actionError.value = "";
  try {
    if (updateState.updateAvailable && !updateState.downloaded) {
      applyState(await codexDesktop.app.downloadUpdate());
      return;
    }
    if (updateState.status === "downloaded") {
      await codexDesktop.app.installUpdate();
      return;
    }
    applyState(await codexDesktop.app.checkForUpdates());
  } catch (error) {
    actionError.value =
      error instanceof Error && error.message.includes("AI task is running")
        ? t("settingsUpdate.installBlocked")
        : t("settingsUpdate.actionFailed");
  } finally {
    actionRunning.value = false;
  }
};

onMounted(async () => {
  offUpdateState = codexDesktop.app.onUpdateState(applyState);
  applyState(await codexDesktop.app.getUpdateState());
});

onBeforeUnmount(() => {
  offUpdateState?.();
  offUpdateState = null;
});
</script>

<style scoped>
.settings-update-actions {
  gap: 8px;
  align-items: center;
}

.settings-update-progress {
  display: grid;
  gap: 6px;
}

.settings-update-progress-track {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border) 55%, transparent);
}

.settings-update-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 160ms ease;
}
</style>
