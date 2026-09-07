<template>
  <Transition name="topbar-update-slide">
    <button
      v-if="visible"
      class="topbar-update-notice"
      :class="{
        'is-downloading': updateState.status === 'downloading',
        'is-downloaded': updateState.status === 'downloaded',
      }"
      type="button"
      :disabled="actionDisabled"
      :aria-label="ariaLabel"
      @click="onClick"
    >
      <component :is="noticeIcon" class="topbar-update-notice__icon" aria-hidden="true" />
      <span class="topbar-update-notice__text" aria-live="polite">{{ label }}</span>
    </button>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Download, LoaderCircle, RotateCcw } from "lucide-vue-next";
import { useAppShellStore } from "../../../stores/appShell.store";
import { codexDesktop } from "../../../api/codexDesktopClient";
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
let offUpdateState: (() => void) | null = null;

const applyState = (next: AppUpdateSnapshot) => {
  Object.assign(updateState, next);
};

const visible = computed(
  () =>
    updateState.status === "available" || updateState.status === "downloading" || updateState.status === "downloaded"
);

const progressPercent = computed(() => {
  const percent = Number(updateState.progress?.percent ?? 0);
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
});

const label = computed(() => {
  if (updateState.status === "downloading") {
    return t("topbarUpdate.downloading", { percent: progressPercent.value });
  }
  if (updateState.status === "downloaded") return t("topbarUpdate.install");
  return t("topbarUpdate.available");
});

const ariaLabel = computed(() => {
  const version = String(updateState.latestVersion ?? "").trim();
  if (updateState.status === "downloaded") return t("topbarUpdate.installAria");
  if (updateState.status === "downloading") {
    return t("topbarUpdate.downloadingAria", { percent: progressPercent.value });
  }
  return version ? t("topbarUpdate.availableVersionAria", { version }) : t("topbarUpdate.availableAria");
});

const noticeIcon = computed(() => {
  if (updateState.status === "downloaded") return RotateCcw;
  if (updateState.status === "downloading") return LoaderCircle;
  return Download;
});

const actionDisabled = computed(() => actionRunning.value || updateState.status === "downloading");

async function onClick() {
  if (actionDisabled.value) return;
  actionRunning.value = true;
  try {
    if (updateState.status === "downloaded") {
      await codexDesktop.app.installUpdate();
      return;
    }
    if (updateState.status === "available") {
      applyState(await codexDesktop.app.downloadUpdate());
    }
  } catch {
    useAppShellStore().openSettings("update");
  } finally {
    actionRunning.value = false;
  }
}

onMounted(async () => {
  offUpdateState = codexDesktop.app.onUpdateState(applyState);
  applyState(await codexDesktop.app.getUpdateState());
});

onBeforeUnmount(() => {
  offUpdateState?.();
  offUpdateState = null;
});
</script>
