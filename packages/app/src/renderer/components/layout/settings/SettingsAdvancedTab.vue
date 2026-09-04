<template>
  <section class="advanced-settings" :aria-label="t('advancedSettings.aria')">
    <header class="advanced-settings__header">
      <span class="advanced-settings__badge">{{ t("advancedSettings.experimental") }}</span>
      <h2>{{ t("advancedSettings.title") }}</h2>
      <p>{{ t("advancedSettings.description") }}</p>
    </header>

    <article class="advanced-settings__card">
      <div class="advanced-settings__copy">
        <h3>{{ t("advancedSettings.customModeTitle") }}</h3>
        <p>{{ t("advancedSettings.customModeDescription") }}</p>
        <p class="advanced-settings__warning">{{ t("advancedSettings.customModeWarning") }}</p>
      </div>
      <div class="advanced-settings__actions">
        <span class="advanced-settings__status">
          {{
            appShellStore.runtimeMode === "custom"
              ? t("advancedSettings.customModeActive")
              : t("advancedSettings.agentModeActive")
          }}
        </span>
        <button
          v-if="appShellStore.runtimeMode !== 'custom'"
          type="button"
          class="advanced-settings__button"
          data-testid="enable-custom-mode"
          @click="appShellStore.setRuntimeMode('custom')"
        >
          {{ t("advancedSettings.enableCustomMode") }}
        </button>
        <button
          v-else
          type="button"
          class="advanced-settings__button is-primary"
          data-testid="return-agent-mode"
          @click="appShellStore.setRuntimeMode('codex')"
        >
          {{ t("advancedSettings.returnAgentMode") }}
        </button>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useAppShellStore } from "../../../stores/appShell.store";

const { t } = useI18n();
const appShellStore = useAppShellStore();
</script>

<style scoped>
.advanced-settings {
  display: grid;
  gap: 24px;
  padding: 32px;
}

.advanced-settings__header,
.advanced-settings__copy {
  display: grid;
  gap: 8px;
}

.advanced-settings__header h2,
.advanced-settings__copy h3,
.advanced-settings__header p,
.advanced-settings__copy p {
  margin: 0;
}

.advanced-settings__header p,
.advanced-settings__copy p,
.advanced-settings__status {
  color: var(--text-muted);
  line-height: 1.6;
}

.advanced-settings__badge {
  width: fit-content;
  padding: 4px 8px;
  border: 1px solid color-mix(in srgb, var(--warning) 46%, var(--border));
  border-radius: 999px;
  color: var(--warning);
  font-size: 11px;
  font-weight: 700;
}

.advanced-settings__card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
}

.advanced-settings__copy {
  max-width: 660px;
}

.advanced-settings__warning {
  color: var(--warning) !important;
}

.advanced-settings__actions {
  display: grid;
  flex: 0 0 auto;
  justify-items: end;
  gap: 10px;
}

.advanced-settings__status {
  font-size: 12px;
}

.advanced-settings__button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text);
  background: var(--surface-3);
  cursor: pointer;
}

.advanced-settings__button.is-primary {
  border-color: var(--accent);
  color: var(--button-primary-fg, #fff);
  background: var(--accent);
}

@media (max-width: 760px) {
  .advanced-settings__card {
    align-items: stretch;
    flex-direction: column;
  }

  .advanced-settings__actions {
    justify-items: stretch;
  }
}
</style>
