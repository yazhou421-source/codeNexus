<template>
  <button class="account-status" type="button" :title="label" :aria-label="label" @click="openAccount">
    <UserRound :size="14" aria-hidden="true" />
    <span aria-live="polite">{{ label }}</span>
  </button>
</template>
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from "vue";
import { UserRound } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { useAccountStatusStore } from "../../../stores/accountStatus.store";
import { useAppShellStore } from "../../../stores/appShell.store";
import { codexDesktop } from "../../../api/codexDesktopClient";
const store = useAccountStatusStore();
const shell = useAppShellStore();
const { t } = useI18n();
const label = computed(() => `ChatGPT/Codex ${t(`accountStatus.states.${store.status}`)}`);
const openAccount = () => {
  shell.openSettings("models");
};
let offLogin: (() => void) | undefined;
function refreshWhenVisible() {
  if (document.visibilityState === "visible" && Date.now() - store.checkedAt > 60_000) void store.refresh();
}
onMounted(() => {
  offLogin = codexDesktop.app.onAccountLoginCompleted((event) => {
    void store.loginCompleted(event.success);
  });
  void store.refresh();
  window.addEventListener("focus", refreshWhenVisible);
});
onBeforeUnmount(() => {
  offLogin?.();
  window.removeEventListener("focus", refreshWhenVisible);
});
</script>
<style scoped>
.account-status {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 240px;
  min-width: 0;
  padding: 5px 8px;
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 12px;
  -webkit-app-region: no-drag;
}
.account-status span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-status:hover {
  background: var(--surface-2);
  color: var(--text);
}
.account-status:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
