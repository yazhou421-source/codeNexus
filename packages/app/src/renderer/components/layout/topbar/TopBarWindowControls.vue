<template>
  <template v-if="!isMac">
    <button
      id="btn-window-minimize"
      class="btn-icon"
      type="button"
      :aria-label="t('topbarExtra.minimize')"
      @click="onWindowMinimize"
    >
      <Minus aria-hidden="true" />
    </button>
    <button
      id="btn-window-maximize"
      class="btn-icon"
      type="button"
      :aria-label="windowExpanded ? t('topbarExtra.restore') : t('topbarExtra.maximize')"
      @click="onWindowToggleMaximize"
    >
      <Copy v-if="windowExpanded" aria-hidden="true" />
      <Square v-else aria-hidden="true" />
    </button>
    <button
      id="btn-window-close"
      class="btn-icon danger"
      type="button"
      :disabled="closeInFlight || appClosingStore.visible"
      :aria-label="t('topbarExtra.close')"
      @click="onWindowClose"
    >
      <X aria-hidden="true" />
    </button>
  </template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Copy, Minus, Square, X } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { useAppClosingStore } from "../../../stores/appClosing.store";
import type { AppWindowState } from "@codenexus/shared/ipc/contracts";

const isMac = /Mac/i.test(navigator.platform);
const appClosingStore = useAppClosingStore();
const { t } = useI18n();

const windowState = ref<AppWindowState>({
  isMaximized: false,
  isMinimized: false,
  isFullScreen: false,
});

const windowExpanded = computed(() => windowState.value.isMaximized || windowState.value.isFullScreen);

let stopWindowStateListener: (() => void) | null = null;
const closeInFlight = ref(false);
let closeResetTimer: ReturnType<typeof setTimeout> | null = null;

function clearCloseResetTimer() {
  if (!closeResetTimer) return;
  clearTimeout(closeResetTimer);
  closeResetTimer = null;
}

function scheduleCloseReset() {
  clearCloseResetTimer();
  closeResetTimer = setTimeout(() => {
    closeResetTimer = null;
    if (!appClosingStore.visible) closeInFlight.value = false;
  }, 2_500);
}

function onWindowMinimize() {
  void codexDesktop.window.minimize().catch((error) => {
    console.warn("[TopBarWindowControls] window minimize failed", error);
  });
}

function onWindowToggleMaximize() {
  void codexDesktop.window.toggleMaximize().catch((error) => {
    console.warn("[TopBarWindowControls] window maximize toggle failed", error);
  });
}

function onWindowClose() {
  if (closeInFlight.value || appClosingStore.visible) return;
  closeInFlight.value = true;
  void codexDesktop.window
    .close()
    .then(() => {
      scheduleCloseReset();
    })
    .catch((error) => {
      clearCloseResetTimer();
      closeInFlight.value = false;
      console.warn("[TopBarWindowControls] window close failed", error);
    });
}

watch(
  () => appClosingStore.visible,
  (visible) => {
    if (visible) {
      clearCloseResetTimer();
      return;
    }
    closeInFlight.value = false;
  }
);

onMounted(() => {
  void (async () => {
    try {
      windowState.value = await codexDesktop.window.getState();
    } catch {}
  })();

  try {
    stopWindowStateListener = codexDesktop.window.onState((payload) => {
      windowState.value = payload;
    });
  } catch {}
});

onBeforeUnmount(() => {
  try {
    stopWindowStateListener?.();
  } catch {}
  stopWindowStateListener = null;
  clearCloseResetTimer();
});
</script>
