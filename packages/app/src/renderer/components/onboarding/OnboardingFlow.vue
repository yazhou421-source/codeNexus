<template>
  <div class="onboarding" role="dialog" aria-modal="true" :aria-label="t('onboarding.aria')">
    <section class="onboarding-panel" :data-step="store.step">
      <div class="onboarding-brand">
        <strong>Calmnova Code</strong>
        <span>{{ t("onboarding.brandSubtitle") }}</span>
      </div>

      <template v-if="store.step === 'welcome'">
        <div class="onboarding-copy onboarding-copy--center">
          <span class="onboarding-kicker">{{ t("onboarding.welcome.kicker") }}</span>
          <h1>{{ t("onboarding.welcome.title") }}</h1>
          <p>{{ t("onboarding.welcome.description") }}</p>
        </div>
        <ul class="onboarding-points">
          <li>{{ t("onboarding.welcome.files") }}</li>
          <li>{{ t("onboarding.welcome.commands") }}</li>
          <li>{{ t("onboarding.welcome.security") }}</li>
        </ul>
        <button class="onboarding-primary" type="button" data-testid="onboarding-start" @click="store.start()">
          {{ t("onboarding.welcome.start") }}
        </button>
      </template>

      <template v-else-if="store.step === 'service'">
        <div class="onboarding-copy">
          <span class="onboarding-kicker">{{ t("onboarding.step", { current: 1, total: 3 }) }}</span>
          <h1>{{ t("onboarding.service.title") }}</h1>
          <p>{{ t("onboarding.service.description") }}</p>
        </div>
        <div class="onboarding-services" data-testid="onboarding-services">
          <button class="onboarding-service" type="button" @click="store.selectService('chatgpt')">
            <strong>ChatGPT / Codex</strong>
            <span>{{ t("onboarding.service.chatgpt") }}</span>
          </button>
          <button
            v-for="provider in providerStore.providers"
            :key="provider.id"
            class="onboarding-service"
            type="button"
            :data-provider="provider.id"
            @click="store.selectService(provider.id as OnboardingService)"
          >
            <strong>{{ providerName(provider.id, provider.displayName) }}</strong>
            <span>{{ t("onboarding.service.apiKey") }}</span>
          </button>
        </div>
      </template>

      <template v-else-if="store.step === 'account'">
        <div class="onboarding-copy">
          <span class="onboarding-kicker">{{ t("onboarding.step", { current: 2, total: 3 }) }}</span>
          <h1>{{ selectedServiceName }}</h1>
          <p>{{ accountDescription }}</p>
        </div>

        <div v-if="store.selectedService === 'chatgpt'" class="onboarding-account-status">
          <div v-if="store.accountState === 'checking'" class="onboarding-status">
            {{ t("onboarding.account.checking") }}
          </div>
          <div v-else-if="store.accountState === 'logged_in'" class="onboarding-status is-success">
            <strong>{{ t("onboarding.account.loggedIn") }}</strong>
            <span v-if="store.accountEmail">{{ store.accountEmail }}</span>
          </div>
          <div v-else-if="store.accountState === 'logging_in'" class="onboarding-status is-waiting">
            <strong>{{ t("onboarding.account.waiting") }}</strong>
            <span>{{ t("onboarding.account.browserHint") }}</span>
          </div>
          <div v-else-if="store.accountState === 'failed'" class="onboarding-status is-error">
            {{ accountErrorText }}
          </div>
          <div v-else class="onboarding-status">{{ t("onboarding.account.loggedOut") }}</div>

          <div class="onboarding-actions">
            <button
              v-if="store.accountState !== 'logged_in' && store.accountState !== 'logging_in'"
              class="onboarding-primary"
              type="button"
              :disabled="store.busy"
              data-testid="chatgpt-login"
              @click="store.startChatGptLogin()"
            >
              {{ t("onboarding.account.login") }}
            </button>
            <button
              v-if="store.accountState === 'logging_in'"
              class="onboarding-secondary"
              type="button"
              :disabled="store.busy"
              @click="store.cancelChatGptLogin()"
            >
              {{ t("common.cancel") }}
            </button>
            <button
              v-if="store.accountState === 'failed' || store.accountState === 'logged_out'"
              class="onboarding-secondary"
              type="button"
              :disabled="store.busy"
              @click="store.checkAccount()"
            >
              {{ t("common.retry") }}
            </button>
          </div>
        </div>

        <div v-else class="onboarding-provider">
          <div v-if="!providerStore.secureStorageAvailable" class="onboarding-status is-error">
            {{ t("onboarding.provider.secureStorageUnavailable") }}
          </div>
          <div v-else-if="store.selectedProvider?.configured" class="onboarding-status is-success">
            <strong>{{ t("onboarding.provider.saved") }}</strong>
            <span>{{ t("onboarding.provider.notVerified") }}</span>
          </div>
          <form v-else class="onboarding-key-form" @submit.prevent="saveProviderKey">
            <label for="onboarding-provider-key">{{ t("onboarding.provider.keyLabel") }}</label>
            <input
              id="onboarding-provider-key"
              v-model="apiKeyDraft"
              type="password"
              autocomplete="new-password"
              spellcheck="false"
              :disabled="store.busy || !providerStore.secureStorageAvailable"
              :placeholder="t('onboarding.provider.keyPlaceholder')"
              data-testid="provider-api-key"
            />
            <button
              class="onboarding-primary"
              type="submit"
              :disabled="store.busy || !providerStore.secureStorageAvailable || !apiKeyDraft.trim()"
            >
              {{ t("onboarding.provider.save") }}
            </button>
          </form>
          <div v-if="store.errorCode" class="onboarding-error">{{ providerErrorText }}</div>
        </div>

        <div class="onboarding-footer">
          <button class="onboarding-link" type="button" @click="store.back()">{{ t("common.back") }}</button>
          <button
            class="onboarding-primary"
            type="button"
            :disabled="!store.accountReady || store.busy"
            data-testid="account-continue"
            @click="store.continueToProject()"
          >
            {{ t("common.continue") }}
          </button>
        </div>
      </template>

      <template v-else-if="store.step === 'project'">
        <div class="onboarding-copy">
          <span class="onboarding-kicker">{{ t("onboarding.step", { current: 3, total: 3 }) }}</span>
          <h1>{{ t("onboarding.project.title") }}</h1>
          <p>{{ t("onboarding.project.description") }}</p>
        </div>
        <div v-if="store.projectPath" class="onboarding-project-path">{{ store.projectPath }}</div>
        <div v-if="store.errorCode" class="onboarding-error">{{ t("onboarding.project.openFailed") }}</div>
        <div class="onboarding-actions onboarding-actions--stacked">
          <button
            class="onboarding-primary"
            type="button"
            :disabled="store.busy"
            data-testid="select-project"
            @click="store.chooseProject()"
          >
            {{ t("onboarding.project.choose") }}
          </button>
          <button class="onboarding-secondary" type="button" :disabled="store.busy" @click="store.skipProject()">
            {{ t("onboarding.project.later") }}
          </button>
        </div>
        <button class="onboarding-link" type="button" @click="store.back()">{{ t("common.back") }}</button>
      </template>

      <template v-else>
        <div class="onboarding-copy onboarding-copy--center">
          <span class="onboarding-kicker">{{ t("onboarding.complete.kicker") }}</span>
          <h1>{{ t("onboarding.complete.title") }}</h1>
          <p>{{ t("onboarding.complete.description") }}</p>
        </div>
        <dl class="onboarding-summary">
          <div>
            <dt>{{ t("onboarding.complete.service") }}</dt>
            <dd>{{ selectedServiceName }}</dd>
          </div>
          <div>
            <dt>{{ t("onboarding.complete.model") }}</dt>
            <dd>{{ selectedModelName }}</dd>
          </div>
          <div>
            <dt>{{ t("onboarding.complete.project") }}</dt>
            <dd>{{ store.projectPath || t("onboarding.complete.noProject") }}</dd>
          </div>
        </dl>
        <div class="onboarding-footer">
          <button class="onboarding-link" type="button" @click="store.back()">{{ t("common.back") }}</button>
          <button
            class="onboarding-primary"
            type="button"
            :disabled="store.busy"
            data-testid="finish-onboarding"
            @click="store.finish()"
          >
            {{ t("onboarding.complete.enter") }}
          </button>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { OnboardingService } from "@codenexus/shared/localSettings";
import { useOnboardingStore } from "../../stores/onboarding.store";
import { useProviderRegistryStore } from "../../stores/providerRegistry.store";

const { t } = useI18n();
const store = useOnboardingStore();
const providerStore = useProviderRegistryStore();
const apiKeyDraft = ref("");

const selectedServiceName = computed(() => {
  if (store.selectedService === "chatgpt") return "ChatGPT / Codex";
  const provider = store.selectedProvider;
  return provider ? providerName(provider.id, provider.displayName) : t("onboarding.service.title");
});
const accountDescription = computed(() =>
  store.selectedService === "chatgpt" ? t("onboarding.account.description") : t("onboarding.provider.description")
);
const accountErrorText = computed(() => {
  if (store.errorCode === "agent_unavailable") return t("onboarding.account.agentUnavailable");
  if (store.errorCode === "login_not_confirmed") return t("onboarding.account.notConfirmed");
  return t("onboarding.account.failed");
});
const providerErrorText = computed(
  () =>
    providerStore.errorText ||
    (store.errorCode === "secure_storage_unavailable"
      ? t("onboarding.provider.secureStorageUnavailable")
      : t("onboarding.provider.saveFailed"))
);
const selectedModelName = computed(() => {
  if (store.selectedService === "chatgpt") return "Codex";
  const provider = store.selectedProvider;
  return (
    provider?.models.find((model) => model.id === provider.defaultModelId)?.displayName ??
    provider?.defaultModelId ??
    "—"
  );
});

function providerName(providerId: string, fallback: string): string {
  if (providerId === "kimi") return "Kimi";
  if (providerId === "qwen") return "Qwen";
  if (providerId === "zhipu") return "GLM";
  return fallback;
}

async function saveProviderKey(): Promise<void> {
  const secret = apiKeyDraft.value.trim();
  if (!secret) return;
  try {
    await store.saveProviderKey(secret);
  } finally {
    apiKeyDraft.value = "";
  }
}

onMounted(() => {
  if (store.step === "account") {
    void store.prepareSelectedService();
  } else if (providerStore.loadState === "idle" || providerStore.loadState === "error") {
    void providerStore.refresh();
  }
});
</script>

<style scoped>
.onboarding {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 32px;
  color: var(--text);
  background:
    radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 46%),
    var(--app-bg, var(--surface-0));
}

.onboarding-panel {
  width: min(680px, 100%);
  max-height: calc(100vh - 64px);
  overflow: auto;
  display: grid;
  gap: 24px;
  padding: 34px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface-1) 96%, transparent);
  box-shadow: var(--ui-shadow-md, 0 24px 64px rgb(0 0 0 / 0.28));
}

.onboarding-kicker {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.onboarding-brand {
  display: grid;
  gap: 3px;
}
.onboarding-brand strong {
  font-size: 14px;
  letter-spacing: 0.03em;
}
.onboarding-brand span {
  color: var(--text-muted);
  font-size: 12px;
}

.onboarding-copy {
  display: grid;
  gap: 9px;
}
.onboarding-copy--center {
  text-align: center;
}
.onboarding-copy h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
}
.onboarding-copy p {
  margin: 0;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1.65;
}
.onboarding-points {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 18px 22px 18px 40px;
  border-radius: 12px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}
.onboarding-services {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.onboarding-service {
  display: grid;
  gap: 7px;
  min-height: 94px;
  padding: 16px;
  text-align: left;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
}
.onboarding-service:hover {
  border-color: var(--border-accent);
  background: var(--surface-3);
}
.onboarding-service span {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}
.onboarding-account-status,
.onboarding-provider {
  display: grid;
  gap: 14px;
}
.onboarding-status {
  display: grid;
  gap: 5px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 13px;
}
.onboarding-status.is-success {
  border-color: color-mix(in srgb, var(--success) 45%, var(--border));
  color: var(--text);
}
.onboarding-status.is-waiting {
  border-color: color-mix(in srgb, var(--warning) 45%, var(--border));
}
.onboarding-status.is-error,
.onboarding-error {
  color: var(--danger);
}
.onboarding-key-form {
  display: grid;
  gap: 10px;
}
.onboarding-key-form label {
  font-size: 13px;
  font-weight: 600;
}
.onboarding-key-form input {
  width: 100%;
  height: 42px;
  padding: 0 12px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  font: inherit;
}
.onboarding-actions {
  display: flex;
  gap: 10px;
}
.onboarding-actions--stacked {
  display: grid;
}
.onboarding-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.onboarding-primary,
.onboarding-secondary,
.onboarding-link {
  min-height: 40px;
  padding: 0 17px;
  border-radius: 10px;
  font: inherit;
  cursor: pointer;
}
.onboarding-primary {
  color: var(--button-primary-fg, #fff);
  background: var(--accent);
  border: 1px solid var(--accent);
}
.onboarding-secondary {
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.onboarding-link {
  color: var(--text-muted);
  background: transparent;
  border: 0;
}
.onboarding-primary:disabled,
.onboarding-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}
.onboarding-project-path {
  padding: 12px;
  overflow-wrap: anywhere;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  font-family: var(--font-mono);
  font-size: 12px;
}
.onboarding-summary {
  display: grid;
  gap: 1px;
  overflow: hidden;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--border);
}
.onboarding-summary div {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 12px;
  padding: 12px 14px;
  background: var(--surface-2);
}
.onboarding-summary dt {
  color: var(--text-muted);
}
.onboarding-summary dd {
  margin: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 620px) {
  .onboarding {
    padding: 16px;
  }
  .onboarding-panel {
    max-height: calc(100vh - 32px);
    padding: 24px;
  }
  .onboarding-services {
    grid-template-columns: 1fr;
  }
}
</style>
