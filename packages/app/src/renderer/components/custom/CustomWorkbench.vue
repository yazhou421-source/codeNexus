<template>
  <div class="custom-workbench">
    <header class="cw-header">
      <div class="cw-header__title">
        <strong>自定义运行时</strong>
        <span class="cw-tag">实验 · 不依赖 codex-app-server</span>
      </div>
      <div class="cw-header__actions">
        <button type="button" class="cw-btn" @click="showConfig = !showConfig">
          {{ showConfig ? "返回对话" : "配置 Provider" }}
        </button>
        <button type="button" class="cw-btn" @click="appShellStore.openSettings('advanced')">高级设置</button>
      </div>
    </header>

    <section v-if="showConfig" class="cw-config">
      <div class="cw-config__list">
        <h2>Providers</h2>
        <p v-if="providers.length === 0" class="cw-config__hint">还没有配置任何 provider，点下方「新增」开始。</p>
        <div
          v-for="provider in providers"
          :key="provider.id"
          class="cw-provider"
          :class="{ 'is-active': provider.id === activeProviderId }"
        >
          <div class="cw-provider__info">
            <span class="cw-provider__name">{{ provider.name }}</span>
            <span class="cw-provider__kind">{{ kindLabel(provider.kind) }}</span>
            <span class="cw-provider__model">{{ provider.model || "未设置模型" }}</span>
          </div>
          <div class="cw-provider__actions">
            <button v-if="provider.id !== activeProviderId" type="button" class="cw-btn" @click="activate(provider.id)">
              激活
            </button>
            <span v-else class="cw-provider__current">当前</span>
            <button type="button" class="cw-btn" @click="edit(provider)">编辑</button>
            <button type="button" class="cw-btn" @click="remove(provider.id)">删除</button>
          </div>
        </div>
        <button type="button" class="cw-btn cw-btn--primary cw-config__add" @click="startNew">+ 新增 Provider</button>
      </div>

      <form v-if="editing" class="cw-form" @submit.prevent="saveProvider">
        <h2>{{ editingId ? "编辑 Provider" : "新增 Provider" }}</h2>
        <label class="cw-field">
          <span>协议</span>
          <select v-model="form.kind">
            <option value="openai-compatible">OpenAI 兼容</option>
            <option value="anthropic">Claude（Anthropic）</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
        <label class="cw-field">
          <span>名称</span>
          <input v-model="form.name" type="text" placeholder="My Provider" />
        </label>
        <label class="cw-field">
          <span>Base URL</span>
          <input v-model="form.baseUrl" type="text" :placeholder="baseUrlPlaceholder" />
        </label>
        <label class="cw-field">
          <span>API Key</span>
          <input v-model="form.apiKey" type="password" placeholder="sk-..." autocomplete="off" />
        </label>
        <label class="cw-field">
          <span>模型</span>
          <input v-model="form.model" type="text" :placeholder="modelPlaceholder" />
        </label>
        <label class="cw-check">
          <input v-model="form.thinking" type="checkbox" />
          <span
            >启用思考 / 推理输出（支持的模型：Claude thinking · Gemini · DeepSeek-R1 等；不支持的模型请勿开启）</span
          >
        </label>
        <div class="cw-config__actions">
          <button
            v-if="form.kind === 'openai-compatible'"
            type="button"
            class="cw-btn"
            :disabled="testing || !canSave"
            @click="testConnection"
          >
            {{ testing ? "测试中…" : "测试连接" }}
          </button>
          <button type="button" class="cw-btn" @click="cancelEdit">取消</button>
          <button type="submit" class="cw-btn cw-btn--primary" :disabled="!canSave">保存并激活</button>
        </div>
        <p v-if="form.kind !== 'openai-compatible'" class="cw-config__hint">
          连接测试目前仅支持 OpenAI 兼容协议；Claude / Gemini 直接保存后在对话中验证。
        </p>
        <p v-if="testMessage" class="cw-config__test" :class="{ 'is-error': !testOk }">{{ testMessage }}</p>
      </form>
    </section>

    <template v-else>
      <div ref="listRef" class="cw-messages">
        <div v-if="customChatStore.messages.length === 0" class="cw-empty">
          <p>这是一个直连自定义 provider 的极简对话。发送一条消息开始。</p>
        </div>
        <div
          v-for="message in customChatStore.messages"
          :key="message.id"
          class="cw-msg"
          :class="[`cw-msg--${message.role}`, { 'is-error': message.error }]"
        >
          <div class="cw-msg__role">{{ message.role === "user" ? "你" : message.error ? "错误" : "助手" }}</div>
          <details v-if="message.role === 'assistant' && message.reasoning" class="cw-think">
            <summary>💭 思考过程</summary>
            <pre class="cw-think__body mono">{{ message.reasoning }}</pre>
          </details>
          <AgentMarkdownContent
            v-if="message.role === 'assistant' && !message.error && message.content"
            class="cw-msg__body cw-msg__body--md agent-markdown-body"
            :html="markdownHtml(message)"
          />
          <div v-else class="cw-msg__body" :class="{ 'cw-msg__body--pending': message.streaming && !message.content }">
            {{ message.content || (message.streaming ? "思考中…" : "") }}
          </div>
          <div v-if="message.tools && message.tools.length" class="cw-tools">
            <div v-for="tool in message.tools" :key="tool.callId" class="cw-tool" :class="`cw-tool--${tool.status}`">
              <div class="cw-tool__head">
                <span class="cw-tool__icon" aria-hidden="true">{{ toolIcon(tool.status) }}</span>
                <span class="cw-tool__name mono">{{ tool.name }}</span>
                <span class="cw-tool__args mono">{{ toolArgsSummary(tool.argsText) }}</span>
              </div>
              <details v-if="tool.resultText || tool.error" class="cw-tool__more">
                <summary>{{ tool.error ? "错误" : "结果" }}</summary>
                <pre class="cw-tool__detail mono">{{ tool.error || tool.resultText }}</pre>
              </details>
            </div>
          </div>
        </div>
      </div>

      <footer class="cw-composer">
        <div v-if="customChatStore.pendingApprovals.length" class="cw-approvals">
          <div
            v-for="ap in customChatStore.pendingApprovals"
            :key="ap.approvalId"
            class="cw-approval"
            :class="`cw-approval--${ap.kind}`"
          >
            <div class="cw-approval__head">
              <span class="cw-approval__kind">{{ ap.kind === "command" ? "命令审批" : "文件写改审批" }}</span>
              <span class="cw-approval__title mono">{{ ap.title }}</span>
            </div>
            <pre class="cw-approval__detail mono">{{ ap.detail }}</pre>
            <div class="cw-approval__actions">
              <button type="button" class="cw-btn" @click="customChatStore.respondApproval(ap.approvalId, false)">
                拒绝
              </button>
              <button
                type="button"
                class="cw-btn cw-btn--primary"
                @click="customChatStore.respondApproval(ap.approvalId, true)"
              >
                同意
              </button>
            </div>
          </div>
        </div>

        <p v-if="!hasActiveProvider" class="cw-composer__warn">
          尚未配置可用 Provider，<button type="button" class="cw-link" @click="showConfig = true">点此配置</button>。
        </p>
        <div v-else class="cw-composer__meta">
          <label class="cw-provider-switcher">
            <span>当前</span>
            <select :value="activeProviderId ?? ''" :disabled="customChatStore.sending" @change="onProviderSelect">
              <option v-for="provider in providers" :key="provider.id" :value="provider.id">
                {{ providerOptionLabel(provider) }}
              </option>
            </select>
          </label>
          <span class="cw-ws">
            工作区：<span class="cw-ws__path">{{ workspaceRoot || "未选择（仅聊天）" }}</span>
            <button type="button" class="cw-link" @click="selectWorkspace">
              {{ workspaceRoot ? "更改" : "选择" }}
            </button>
            <button v-if="workspaceRoot" type="button" class="cw-link" @click="clearWorkspace">清除</button>
          </span>
        </div>
        <div class="cw-composer__row">
          <textarea
            v-model="draft"
            class="cw-composer__input"
            rows="2"
            placeholder="给自定义模型发消息…（Enter 发送，Shift+Enter 换行）"
            :disabled="!hasActiveProvider || customChatStore.sending"
            @keydown="onComposerKeydown"
          ></textarea>
          <button type="button" class="cw-btn cw-btn--primary" :disabled="!canSend" @click="submit">发送</button>
        </div>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { codexDesktop } from "../../api/codexDesktopClient";
import AgentMarkdownContent from "../ui/AgentMarkdownContent.vue";
import { useAgentMarkdownRenderer } from "../../features/timeline/useAgentMarkdownRenderer";
import { getCachedUserLocalSettings, patchUserLocalSettings } from "../../domain/localSettings";
import { useAppShellStore } from "../../stores/appShell.store";
import { useCustomChatStore, type CustomChatMessage, type CustomToolActivity } from "../../stores/customChat.store";
import type { TimelineEventItem } from "../../domain/types";
import type { CustomProviderKind, LocalCustomProvider } from "@codenexus/shared/localSettings";

const appShellStore = useAppShellStore();
const customChatStore = useCustomChatStore();

// 复用时间线的 Markdown 渲染层（代码高亮 / mermaid / 复制按钮 + 流式节流），仅适配最小事件对象。
const { getMarkdownEventHtml } = useAgentMarkdownRenderer({ key: () => "custom" });
function markdownHtml(message: CustomChatMessage): string {
  return getMarkdownEventHtml({ id: message.id, paramsText: message.content } as unknown as TimelineEventItem);
}

const showConfig = ref(false);
const draft = ref("");
const listRef = ref<HTMLElement | null>(null);

const testing = ref(false);
const testMessage = ref("");
const testOk = ref(false);

const providers = ref<LocalCustomProvider[]>([]);
const activeProviderId = ref<string | null>(null);
const workspaceRoot = ref<string | null>(null);

const editing = ref(false);
const editingId = ref<string | null>(null);
const form = ref<{
  kind: CustomProviderKind;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  thinking: boolean;
}>({
  kind: "openai-compatible",
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  thinking: false,
});

function kindLabel(kind: CustomProviderKind): string {
  if (kind === "anthropic") return "Claude";
  if (kind === "gemini") return "Gemini";
  return "OpenAI 兼容";
}

const baseUrlPlaceholder = computed(() => {
  if (form.value.kind === "anthropic") return "https://api.anthropic.com";
  if (form.value.kind === "gemini") return "https://generativelanguage.googleapis.com";
  return "https://api.openai.com/v1";
});

const modelPlaceholder = computed(() => {
  if (form.value.kind === "anthropic") return "claude-...";
  if (form.value.kind === "gemini") return "gemini-...";
  return "gpt-4o-mini";
});

const activeProvider = computed(
  () => providers.value.find((provider) => provider.id === activeProviderId.value) ?? null
);
const hasActiveProvider = computed(() =>
  Boolean(
    activeProvider.value && activeProvider.value.baseUrl && activeProvider.value.apiKey && activeProvider.value.model
  )
);
function providerOptionLabel(provider: LocalCustomProvider): string {
  return `${provider.name} · ${kindLabel(provider.kind)} · ${provider.model || "未设置模型"}`;
}

const canSave = computed(
  () =>
    form.value.baseUrl.trim().length > 0 && form.value.apiKey.trim().length > 0 && form.value.model.trim().length > 0
);

const canSend = computed(() => hasActiveProvider.value && !customChatStore.sending && draft.value.trim().length > 0);

function loadFromSettings() {
  const { customProviders } = getCachedUserLocalSettings().settings;
  providers.value = customProviders.providers;
  activeProviderId.value = customProviders.activeProviderId;
  workspaceRoot.value = customProviders.workspaceRoot;
}

async function persist() {
  // IPC 结构化克隆前转成纯对象快照（剥离 Vue 响应式代理），避免极端情况下克隆失败导致静默不持久化。
  const plainProviders = providers.value.map((provider) => ({
    id: provider.id,
    kind: provider.kind,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    thinking: provider.thinking,
  }));
  await patchUserLocalSettings({
    customProviders: {
      activeProviderId: activeProviderId.value,
      providers: plainProviders,
      workspaceRoot: workspaceRoot.value,
    },
  });
  loadFromSettings();
}

function startNew() {
  editingId.value = null;
  form.value = { kind: "openai-compatible", name: "", baseUrl: "", apiKey: "", model: "", thinking: false };
  testMessage.value = "";
  editing.value = true;
}

function edit(provider: LocalCustomProvider) {
  editingId.value = provider.id;
  form.value = {
    kind: provider.kind,
    name: provider.name,
    baseUrl: provider.baseUrl ?? "",
    apiKey: provider.apiKey ?? "",
    model: provider.model,
    thinking: provider.thinking ?? false,
  };
  testMessage.value = "";
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

async function saveProvider() {
  if (!canSave.value) return;
  const id = editingId.value || `cp-${Date.now()}`;
  const provider: LocalCustomProvider = {
    id,
    kind: form.value.kind,
    name: form.value.name.trim() || "Custom Provider",
    baseUrl: form.value.baseUrl.trim(),
    apiKey: form.value.apiKey.trim(),
    model: form.value.model.trim(),
    thinking: form.value.thinking,
  };
  const next = providers.value.filter((item) => item.id !== id);
  next.push(provider);
  providers.value = next;
  activeProviderId.value = id;
  await persist();
  editing.value = false;
}

async function activate(id: string) {
  activeProviderId.value = id;
  await persist();
}

async function onProviderSelect(event: Event) {
  const id = String((event.target as HTMLSelectElement | null)?.value ?? "").trim();
  if (!id || id === activeProviderId.value || customChatStore.sending) return;
  await activate(id);
}

async function remove(id: string) {
  providers.value = providers.value.filter((item) => item.id !== id);
  if (activeProviderId.value === id) activeProviderId.value = providers.value[0]?.id ?? null;
  if (editingId.value === id) editing.value = false;
  await persist();
}

async function testConnection() {
  if (!canSave.value || testing.value) return;
  testing.value = true;
  testMessage.value = "";
  try {
    const result = await codexDesktop.app.testCodexProvider({
      baseUrl: form.value.baseUrl.trim(),
      apiKey: form.value.apiKey.trim(),
    });
    testOk.value = result.ok;
    testMessage.value = result.ok
      ? `连接成功${typeof result.modelCount === "number" ? `，发现 ${result.modelCount} 个模型` : ""}。`
      : `连接失败：${result.message}`;
  } catch (error: unknown) {
    testOk.value = false;
    testMessage.value = `连接失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    testing.value = false;
  }
}

function submit() {
  if (!canSend.value) return;
  const providerId = activeProvider.value?.id ?? activeProviderId.value;
  const text = draft.value;
  draft.value = "";
  void customChatStore.send(text, { providerId });
}

async function selectWorkspace() {
  const dir = await codexDesktop.workspace.select();
  if (!dir) return;
  workspaceRoot.value = dir;
  await persist();
}

async function clearWorkspace() {
  workspaceRoot.value = null;
  await persist();
}

function toolIcon(status: CustomToolActivity["status"]): string {
  if (status === "running") return "⏳";
  if (status === "error") return "✗";
  return "✓";
}

// 工具入参（JSON 串）的紧凑摘要：优先取 command/path/processId，否则截断原串。
function toolArgsSummary(argsText: string): string {
  const text = String(argsText ?? "").trim();
  if (!text) return "";
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (obj && typeof obj === "object") {
      if (typeof obj.command === "string") return obj.command;
      if (typeof obj.path === "string") return obj.path;
      if (typeof obj.processId === "string") return obj.processId;
    }
  } catch {
    // 非 JSON：直接截断展示
  }
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function onComposerKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}

watch(
  () => [customChatStore.messages.length, customChatStore.sending] as const,
  () => {
    void nextTick(() => {
      if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight;
    });
  }
);

onMounted(() => {
  loadFromSettings();
  showConfig.value = !hasActiveProvider.value;
  if (providers.value.length === 0) startNew();
});
</script>

<style scoped>
.custom-workbench {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--text);
  background: var(--bg);
}

.cw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.cw-header__title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cw-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--text-muted);
  background: var(--surface-3);
}

.cw-header__actions {
  display: flex;
  gap: 8px;
}

.cw-btn {
  cursor: pointer;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
}

.cw-btn:hover:not(:disabled) {
  border-color: var(--border-accent);
  background: var(--surface-3);
}

.cw-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cw-btn--primary {
  color: var(--fg-success);
  border-color: var(--border-success);
  background: var(--bg-success-soft);
}

.cw-btn--primary:hover:not(:disabled) {
  border-color: var(--border-success-hover);
}

.cw-config {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
  max-width: 620px;
  overflow: auto;
}

.cw-config__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cw-config h2 {
  margin: 0;
  font-size: 16px;
  color: var(--text);
}

.cw-config__hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.cw-config__add {
  align-self: flex-start;
  margin-top: 4px;
}

.cw-provider {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
}

.cw-provider.is-active {
  border-color: var(--border-success);
  background: var(--bg-success-soft);
}

.cw-provider__info {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.cw-provider__name {
  font-weight: 600;
}

.cw-provider__kind {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  color: var(--text-muted);
  background: var(--surface-3);
}

.cw-provider__model {
  font-size: 12px;
  color: var(--text-muted);
}

.cw-provider__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.cw-provider__current {
  font-size: 12px;
  color: var(--fg-success);
}

.cw-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.cw-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: var(--text-muted);
}

.cw-field input,
.cw-field select {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
}

.cw-field input:focus,
.cw-field select:focus {
  outline: none;
  border-color: var(--border-accent);
}

.cw-config__actions {
  display: flex;
  gap: 8px;
}

.cw-config__test {
  margin: 0;
  font-size: 12px;
  color: var(--fg-success);
}

.cw-config__test.is-error {
  color: var(--fg-danger);
}

.cw-messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cw-empty {
  margin: auto;
  font-size: 13px;
  text-align: center;
  color: var(--text-muted);
}

.cw-msg {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 760px;
}

.cw-msg--user {
  align-self: flex-end;
  align-items: flex-end;
}

.cw-msg__role {
  font-size: 11px;
  color: var(--text-muted);
}

.cw-msg__body {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  padding: 10px 12px;
  border-radius: 12px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.cw-msg--user .cw-msg__body {
  border-color: var(--border-accent);
  background: var(--bg-accent-soft);
}

.cw-msg.is-error .cw-msg__body {
  color: var(--fg-danger);
  border-color: var(--border-danger);
  background: var(--bg-danger-soft);
}

.cw-msg__body--pending {
  color: var(--text-muted);
}

.cw-msg__body--md {
  white-space: normal;
}

.cw-composer {
  border-top: 1px solid var(--border);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cw-composer__warn,
.cw-composer__meta {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.cw-link {
  cursor: pointer;
  border: none;
  background: none;
  color: var(--ui-link);
  padding: 0;
  font: inherit;
}

.cw-composer__row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.cw-composer__input {
  flex: 1;
  resize: none;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  line-height: 1.5;
}

.cw-composer__input:focus {
  outline: none;
  border-color: var(--border-accent);
}

/* 工具活动（read/write/命令等） */
.cw-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
}

.cw-tool {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  padding: 6px 8px;
  font-size: 12px;
}

.cw-tool--running {
  border-color: var(--border-accent);
}

.cw-tool--error {
  border-color: var(--border-danger);
}

.cw-tool__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.cw-tool__icon {
  flex-shrink: 0;
}

.cw-tool__name {
  color: var(--text);
  font-weight: 600;
  flex-shrink: 0;
}

.cw-tool__args {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cw-tool__more {
  margin-top: 4px;
}

.cw-tool__more summary {
  cursor: pointer;
  color: var(--text-muted);
  font-size: 11px;
}

.cw-tool__detail {
  margin: 6px 0 0;
  padding: 6px 8px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  border-radius: 6px;
  color: var(--text);
  background: var(--surface-3);
}

/* 审批卡片 */
.cw-approvals {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cw-approval {
  border: 1px solid var(--border-accent);
  border-radius: 10px;
  background: var(--bg-accent-soft);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cw-approval--command {
  border-color: var(--border-danger);
  background: var(--bg-danger-soft);
}

.cw-approval__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.cw-approval__kind {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  flex-shrink: 0;
}

.cw-approval__title {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cw-approval__detail {
  margin: 0;
  padding: 8px;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  border-radius: 6px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.cw-approval__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* composer meta：provider / workspace 两段 */
.cw-composer__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
}

.cw-provider-switcher {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.cw-provider-switcher select {
  max-width: min(420px, 52vw);
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--text);
  padding: 0 28px 0 9px;
  font: inherit;
  font-size: 12px;
}

.cw-provider-switcher select:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.cw-provider-switcher select:focus {
  outline: none;
  border-color: var(--border-accent);
}

.cw-ws {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.cw-ws__path {
  color: var(--text);
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* provider 表单的复选项（启用思考） */
.cw-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

.cw-check input {
  flex-shrink: 0;
}

/* 思考过程折叠区 */
.cw-think {
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  padding: 4px 10px;
  font-size: 12px;
}

.cw-think summary {
  cursor: pointer;
  color: var(--text-muted);
  user-select: none;
}

.cw-think__body {
  margin: 6px 0 2px;
  padding: 8px;
  max-height: 280px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  color: var(--text-muted);
  background: var(--surface-3);
  border-radius: 6px;
}
</style>
