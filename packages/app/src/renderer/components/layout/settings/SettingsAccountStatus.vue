<template>
  <section class="settings-card" :aria-label="t('accountStatus.title')">
    <header class="settings-card-head">
      <div class="settings-card-title">{{ t("accountStatus.title") }}</div>
      <button
        class="btn-mini"
        type="button"
        :disabled="store.busy || store.status === 'logging_in'"
        @click="store.refresh()"
      >
        {{ t("common.refresh") }}
      </button>
    </header>
    <div class="settings-card-body account-details">
      <strong aria-live="polite">ChatGPT/Codex {{ t(`accountStatus.states.${store.status}`) }}</strong>
      <p>{{ t("accountStatus.description") }}</p>
      <p v-if="store.account">
        {{ t("accountStatus.source") }}
        {{ store.account.credentialHome === "environment" ? "CODEX_HOME" : "~/.codex" }} ·
        {{ t(`accountStatus.storage.${store.account.credentialStorage || "unknown"}`) }}
      </p>
      <p v-if="store.account?.planType">{{ t("accountStatus.plan") }} {{ store.account.planType }}</p>
      <p v-if="store.checkedAt">{{ t("accountStatus.checked") }} {{ new Date(store.checkedAt).toLocaleString() }}</p>
      <p v-if="store.error" role="alert">{{ t("accountStatus.failed") }}</p>
      <p v-if="store.status === 'expired'">{{ t("accountStatus.expiredHelp") }}</p>
      <div>
        <button
          v-if="store.status === 'logging_in'"
          class="btn-mini"
          type="button"
          :disabled="store.busy"
          @click="store.cancelLogin()"
        >
          {{ t("common.cancel") }}
        </button>
        <button
          v-else-if="store.status !== 'logged_in' && store.status !== 'checking'"
          class="btn-mini"
          type="button"
          :disabled="store.busy"
          @click="store.login()"
        >
          {{ t("accountStatus.login") }}
        </button>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useAccountStatusStore } from "../../../stores/accountStatus.store";
const { t } = useI18n();
const store = useAccountStatusStore();
onMounted(() => {
  if (Date.now() - store.checkedAt > 60_000) void store.refresh();
});
</script>
<style scoped>
.account-details {
  display: grid;
  gap: 10px;
  margin-bottom: 16px;
  overflow-wrap: anywhere;
}
.account-details p {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
}
</style>
