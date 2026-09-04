<template>
  <section class="settings-card provider-settings" :aria-label="t('providerSettings.aria')">
    <header class="settings-card-head provider-settings-head">
      <div>
        <div class="settings-card-title">{{ t("providerSettings.title") }}</div>
        <div class="provider-settings-subtitle">{{ t("providerSettings.description") }}</div>
      </div>
      <button class="btn-mini" type="button" :disabled="store.loadState === 'loading'" @click="store.refresh()">
        {{ t("common.refresh") }}
      </button>
    </header>

    <div class="settings-card-body provider-settings-body">
      <div v-if="!store.secureStorageAvailable && store.loadState === 'ready'" class="provider-security-warning">
        {{ t("providerSettings.secureStorageUnavailable") }}
      </div>
      <div v-if="store.loadState === 'loading'" class="provider-settings-empty">
        {{ t("providerSettings.loading") }}
      </div>
      <div v-else-if="store.loadState === 'error'" class="provider-settings-empty is-error">
        {{ t("providerSettings.loadFailed", { message: store.errorText }) }}
      </div>

      <template v-else>
        <article
          v-for="provider in store.providers"
          :key="provider.id"
          class="provider-card"
          :data-provider-id="provider.id"
        >
          <header class="provider-card-head">
            <div>
              <div class="provider-card-title">{{ provider.displayName }}</div>
              <div class="provider-card-status" :class="provider.configured ? 'is-configured' : 'is-unconfigured'">
                {{ provider.configured ? t("providerSettings.configured") : t("providerSettings.notConfigured") }}
              </div>
            </div>
            <button
              v-if="provider.configured"
              class="btn-mini"
              type="button"
              :disabled="providerBusy(provider.id)"
              @click="onDelete(provider.id)"
            >
              {{ t("providerSettings.deleteKey") }}
            </button>
          </header>

          <div class="provider-credential-row">
            <template v-if="provider.configured && !editingProviderIds.has(provider.id)">
              <div class="provider-saved-key" aria-hidden="true">••••••••••••</div>
              <span class="provider-saved-copy">{{ t("providerSettings.keySaved") }}</span>
              <button
                class="btn-mini"
                type="button"
                :disabled="providerBusy(provider.id) || !store.secureStorageAvailable"
                @click="beginReplace(provider.id)"
              >
                {{ t("providerSettings.replaceKey") }}
              </button>
            </template>
            <template v-else>
              <input
                class="context-input mono provider-key-input"
                type="password"
                autocomplete="new-password"
                spellcheck="false"
                :value="keyDrafts[provider.id] || ''"
                :placeholder="t('providerSettings.keyPlaceholder')"
                :disabled="providerBusy(provider.id) || !store.secureStorageAvailable"
                :aria-label="t('providerSettings.keyAria', { provider: provider.displayName })"
                @input="setKeyDraft(provider.id, $event)"
                @keydown.enter.prevent="onSave(provider.id)"
              />
              <button class="btn-mini" type="button" :disabled="!canSave(provider.id)" @click="onSave(provider.id)">
                {{ provider.configured ? t("providerSettings.saveReplacement") : t("providerSettings.saveKey") }}
              </button>
              <button
                v-if="provider.configured"
                class="btn-mini"
                type="button"
                :disabled="providerBusy(provider.id)"
                @click="cancelReplace(provider.id)"
              >
                {{ t("common.cancel") }}
              </button>
            </template>
          </div>

          <div class="provider-models-title">{{ t("providerSettings.enabledModels") }}</div>
          <div class="provider-model-list" :class="{ 'is-disabled': !provider.configured }">
            <label v-for="model in provider.models" :key="model.id" class="provider-model-row">
              <span class="provider-model-copy">
                <span class="provider-model-name">{{ model.displayName }}</span>
                <span class="provider-model-id mono">{{ model.id }}</span>
              </span>
              <span class="skill-switch">
                <input
                  class="skill-switch-input"
                  type="checkbox"
                  :checked="model.selected && provider.enabled"
                  :disabled="!provider.configured || providerBusy(provider.id)"
                  @change="onModelToggle(provider, model.id, $event)"
                />
                <span class="skill-switch-track" aria-hidden="true"><span class="skill-switch-thumb"></span></span>
              </span>
            </label>
          </div>

          <div v-if="statusByProvider[provider.id]" class="provider-operation-status">
            {{ statusByProvider[provider.id] }}
          </div>
        </article>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive } from "vue";
import { useI18n } from "vue-i18n";
import type { RouterProviderStatus } from "@codenexus/shared/ipc/contracts";
import { confirmModal } from "../../../ui/modal";
import { useProviderRegistryStore } from "../../../stores/providerRegistry.store";

const { t } = useI18n();
const store = useProviderRegistryStore();
const keyDrafts = reactive<Record<string, string>>({});
const statusByProvider = reactive<Record<string, string>>({});
const editingProviderIds = reactive(new Set<string>());

onMounted(() => {
  if (store.loadState === "idle" || store.loadState === "error") void store.refresh();
});

function providerBusy(providerId: string): boolean {
  return store.operationProviderId === providerId;
}

function setKeyDraft(providerId: string, event: Event): void {
  keyDrafts[providerId] = (event.target as HTMLInputElement | null)?.value ?? "";
}

function canSave(providerId: string): boolean {
  return Boolean(keyDrafts[providerId]?.trim()) && !providerBusy(providerId) && store.secureStorageAvailable;
}

function beginReplace(providerId: string): void {
  keyDrafts[providerId] = "";
  statusByProvider[providerId] = "";
  editingProviderIds.add(providerId);
}

function cancelReplace(providerId: string): void {
  keyDrafts[providerId] = "";
  editingProviderIds.delete(providerId);
}

async function onSave(providerId: string): Promise<void> {
  const key = String(keyDrafts[providerId] ?? "").trim();
  if (!key || !store.secureStorageAvailable) return;
  statusByProvider[providerId] = "";
  try {
    await store.saveApiKey(providerId, key);
    keyDrafts[providerId] = "";
    editingProviderIds.delete(providerId);
    statusByProvider[providerId] = t("providerSettings.saved");
  } catch {
    keyDrafts[providerId] = "";
    statusByProvider[providerId] = store.errorText || t("providerSettings.operationFailed");
  }
}

async function onDelete(providerId: string): Promise<void> {
  const provider = store.providers.find((item) => item.id === providerId);
  if (!provider) return;
  const confirmed = await confirmModal({
    title: t("providerSettings.deleteConfirmTitle"),
    message: t("providerSettings.deleteConfirmMessage", { provider: provider.displayName }),
    confirmText: t("providerSettings.deleteKey"),
    cancelText: t("common.cancel"),
    danger: true,
  });
  if (!confirmed) return;
  statusByProvider[providerId] = "";
  try {
    await store.deleteApiKey(providerId);
    keyDrafts[providerId] = "";
    editingProviderIds.delete(providerId);
    statusByProvider[providerId] = t("providerSettings.deleted");
  } catch {
    statusByProvider[providerId] = store.errorText || t("providerSettings.operationFailed");
  }
}

async function onModelToggle(provider: RouterProviderStatus, modelId: string, event: Event): Promise<void> {
  const checked = Boolean((event.target as HTMLInputElement | null)?.checked);
  const selected = provider.models.filter((model) => model.selected).map((model) => model.id);
  const next = checked ? [...selected, modelId] : selected.filter((id) => id !== modelId);
  statusByProvider[provider.id] = "";
  try {
    await store.configureModels(provider.id, next);
    statusByProvider[provider.id] = t("providerSettings.modelsUpdated");
  } catch {
    statusByProvider[provider.id] = store.errorText || t("providerSettings.operationFailed");
  }
}
</script>

<style scoped>
.provider-settings {
  min-height: 100%;
}

.provider-settings-head {
  align-items: flex-start;
}

.provider-settings-subtitle,
.provider-saved-copy,
.provider-operation-status {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.provider-settings-body {
  display: grid;
  gap: 12px;
}

.provider-security-warning,
.provider-settings-empty {
  border: 1px solid color-mix(in srgb, var(--warning) 38%, var(--border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--warning) 9%, transparent);
  padding: 12px;
  color: var(--text);
  font-size: 13px;
}

.provider-settings-empty.is-error {
  border-color: color-mix(in srgb, var(--danger) 42%, var(--border));
}

.provider-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface-1) 94%, transparent);
  padding: 14px;
}

.provider-card-head,
.provider-credential-row,
.provider-model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.provider-card-title {
  color: var(--text);
  font-size: 14px;
  font-weight: 650;
}

.provider-card-status {
  margin-top: 3px;
  font-size: 11px;
}

.provider-card-status.is-configured {
  color: var(--success);
}

.provider-card-status.is-unconfigured {
  color: var(--text-muted);
}

.provider-credential-row {
  justify-content: flex-start;
  margin-top: 13px;
}

.provider-key-input {
  min-width: 220px;
  flex: 1;
}

.provider-saved-key {
  min-width: 150px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 7px 10px;
  color: var(--text-muted);
  letter-spacing: 0.12em;
}

.provider-models-title {
  margin-top: 15px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.provider-model-list {
  display: grid;
  gap: 2px;
  margin-top: 6px;
}

.provider-model-list.is-disabled {
  opacity: 0.58;
}

.provider-model-row {
  min-height: 44px;
  border-radius: 8px;
  padding: 5px 7px;
}

.provider-model-row:hover {
  background: var(--bg-hover, var(--surface-2));
}

.provider-model-copy {
  display: grid;
  gap: 2px;
}

.provider-model-name {
  color: var(--text);
  font-size: 13px;
}

.provider-model-id {
  color: var(--text-muted);
  font-size: 10px;
}

.provider-operation-status {
  margin-top: 9px;
}
</style>
