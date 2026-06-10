<template>
  <div class="custom-workbench">
    <aside class="cw-sessions">
      <div class="cw-sessions__head">
        <strong>Custom 会话</strong>
        <button type="button" class="cw-btn cw-btn--compact" :disabled="customChatStore.sending" @click="createSession">
          新建
        </button>
      </div>
      <div v-if="customChatStore.loadingSessions" class="cw-sessions__empty">加载中...</div>
      <div v-else-if="customChatStore.sessions.length === 0" class="cw-sessions__empty">暂无历史会话</div>
      <div v-else class="cw-session-list app-scrollbar">
        <div
          v-for="session in customChatStore.sessions"
          :key="session.id"
          class="cw-session"
          :class="{ 'is-active': session.id === customChatStore.currentSessionId }"
        >
          <button
            type="button"
            class="cw-session__main"
            :disabled="customChatStore.sending"
            @click="loadSession(session.id)"
          >
            <span class="cw-session__title">{{ session.title || "新会话" }}</span>
            <span class="cw-session__meta">{{ formatSessionTime(session.updatedAt) }}</span>
            <span v-if="session.providerLabel" class="cw-session__provider">{{ session.providerLabel }}</span>
          </button>
          <button
            type="button"
            class="cw-session__delete"
            :disabled="customChatStore.sending && session.id === customChatStore.currentSessionId"
            title="删除会话"
            @click.stop="deleteSession(session.id)"
          >
            ×
          </button>
        </div>
      </div>
    </aside>

    <section class="cw-main">
      <header class="cw-header">
        <div class="cw-header__title">
          <strong>自定义运行时</strong>
          <span class="cw-tag">实验 · 不依赖 codex-app-server</span>
        </div>
        <div class="cw-header__actions">
          <button type="button" class="cw-btn" @click="runtimeStore.toggleTimelineDebugEnabled()">
            {{ runtimeStore.timelineDebugEnabled ? "隐藏日志" : "日志" }}
          </button>
          <button type="button" class="cw-btn" @click="showConfig = !showConfig">
            {{ showConfig ? "返回对话" : "配置 Provider" }}
          </button>
          <button type="button" class="cw-btn" @click="appShellStore.openModeChooser()">切换模式</button>
        </div>
      </header>

      <section v-if="showConfig" class="cw-config app-scrollbar">
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
              <button
                v-if="provider.id !== activeProviderId"
                type="button"
                class="cw-btn"
                @click="activate(provider.id)"
              >
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
          <label class="cw-field">
            <span>最大输出 tokens</span>
            <input v-model="form.maxOutputTokens" type="number" min="1" step="1" placeholder="留空用服务端默认" />
          </label>
          <label class="cw-field">
            <span>上下文长度（输入 tokens）</span>
            <input v-model="form.contextLimit" type="number" min="1" step="1" placeholder="留空不裁剪历史" />
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

      <div v-else class="cw-chat-container">
        <div ref="listRef" class="cw-messages app-scrollbar">
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
              <summary>
                💭 思考过程
                <ExecutionWaveText
                  v-if="message.streaming"
                  text="(生成中)"
                  :enabled="true"
                  :char-delay-sec="0.15"
                  class="cw-think__status"
                />
              </summary>
              <pre class="cw-think__body mono">{{ message.reasoning }}</pre>
            </details>
            <div v-if="message.role === 'assistant' && !message.error && message.parts?.length" class="cw-msg__parts">
              <template v-for="part in message.parts" :key="part.id">
                <AgentMarkdownContent
                  v-if="part.type === 'text'"
                  class="cw-msg__body cw-msg__body--md agent-markdown-body"
                  :html="markdownHtml(part.id, part.text)"
                />
                <div v-else class="cw-tool" :class="`cw-tool--${part.tool.status}`">
                  <div class="cw-tool__head">
                    <span
                      class="cw-tool__icon"
                      :class="`cw-tool__icon--${part.tool.status}`"
                      :aria-label="toolStatusLabel(part.tool.status)"
                      role="img"
                    ></span>
                    <span class="cw-tool__status">{{ toolStatusLabel(part.tool.status) }}</span>
                    <span class="cw-tool__name mono">{{ part.tool.name }}</span>
                    <span class="cw-tool__args mono">{{ toolArgsSummary(part.tool.argsText) }}</span>
                  </div>
                  <div v-if="toolHasPreview(part.tool.argsText)" class="cw-tool__args-preview">
                    <button
                      type="button"
                      class="cw-tool__args-toggle"
                      @click="toggleToolArgs(part)"
                      :aria-label="isToolArgsOpen(part) ? '折叠参数' : '展开参数'"
                    >
                      {{ isToolArgsOpen(part) ? "▼" : "▶" }} 参数
                    </button>
                    <pre v-show="isToolArgsOpen(part)" class="cw-tool__args-body mono">{{
                      toolArgsPreview(part.tool.argsText)
                    }}</pre>
                  </div>
                  <details v-if="part.tool.resultText || part.tool.error" class="cw-tool__more">
                    <summary>{{ part.tool.error ? "错误" : "结果" }}</summary>
                    <pre class="cw-tool__detail mono">{{ part.tool.error || part.tool.resultText }}</pre>
                  </details>
                </div>
              </template>
            </div>
            <div
              v-else
              class="cw-msg__body"
              :class="{ 'cw-msg__body--pending': message.streaming && !message.content }"
            >
              <template v-if="message.streaming && !message.content">
                <ExecutionWaveText text="思考中" :enabled="true" />
              </template>
              <template v-else>
                {{ message.content }}
              </template>
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
                <button
                  type="button"
                  class="cw-approval__toggle"
                  @click="toggleApprovalDetail(ap.approvalId)"
                  :aria-label="isApprovalCollapsed(ap.approvalId) ? '展开详情' : '折叠详情'"
                >
                  {{ isApprovalCollapsed(ap.approvalId) ? "▶" : "▼" }}
                </button>
              </div>
              <template v-if="!isApprovalCollapsed(ap.approvalId)">
                <template v-if="isDiffContent(ap.detail)">
                  <UnifiedDiffViewer
                    :diffText="ap.detail"
                    :filename="extractFilenameFromDetail(ap.detail)"
                    :showLineNumbers="true"
                    class="cw-approval__diff-viewer"
                  />
                </template>
                <pre v-else class="cw-approval__detail mono">{{ ap.detail }}</pre>
              </template>
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
              工作区：<span class="cw-ws__path">{{ workspaceRoot || "未选择（系统工具）" }}</span>
              <button type="button" class="cw-link" @click="selectWorkspace">
                {{ workspaceRoot ? "更改" : "选择" }}
              </button>
              <button v-if="workspaceRoot" type="button" class="cw-link" @click="clearWorkspace">清除</button>
            </span>
            <span class="cw-context" :class="`cw-context--${contextUsageState}`" :title="contextUsageTitle">
              {{ contextUsageLabel }}
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
            <button
              v-if="customChatStore.sending"
              type="button"
              class="cw-btn cw-btn--danger"
              @click="cancelGeneration"
            >
              停止
            </button>
            <button v-else type="button" class="cw-btn cw-btn--primary" :disabled="!canSend" @click="submit">
              发送
            </button>
          </div>
        </footer>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { codexDesktop } from "../../api/codexDesktopClient";
import AgentMarkdownContent from "../ui/AgentMarkdownContent.vue";
import ExecutionWaveText from "../ui/ExecutionWaveText.vue";
import UnifiedDiffViewer from "../timeline/cards/UnifiedDiffViewer.vue";
import { useAgentMarkdownRenderer } from "../../features/timeline/useAgentMarkdownRenderer";
import { getCachedUserLocalSettings, patchUserLocalSettings } from "../../domain/localSettings";
import { useAppShellStore } from "../../stores/appShell.store";
import { useCustomChatStore, type CustomToolActivity } from "../../stores/customChat.store";
import { useRuntimeStore } from "../../stores/runtime.store";
// 纯函数（字符估算，无 node-only 依赖），与后端裁剪 / store getter 同口径。
import { estimateTokens } from "@codenexus/agent-core/contextWindow";
import type { TimelineEventItem } from "../../domain/types";
import type { CustomProviderKind, LocalCustomProvider } from "@codenexus/shared/localSettings";

const appShellStore = useAppShellStore();
const customChatStore = useCustomChatStore();
const runtimeStore = useRuntimeStore();

// 复用时间线的 Markdown 渲染层（代码高亮 / mermaid / 复制按钮 + 流式节流），仅适配最小事件对象。
const { getMarkdownEventHtml } = useAgentMarkdownRenderer({ key: () => "custom" });
function markdownHtml(id: string, text: string): string {
  return getMarkdownEventHtml({ id, paramsText: text } as unknown as TimelineEventItem);
}

const showConfig = ref(false);
const draft = ref("");
const listRef = ref<HTMLElement | null>(null);
let scrollToBottomRafId: number | null = null;

const testing = ref(false);
const testMessage = ref("");
const testOk = ref(false);

const providers = ref<LocalCustomProvider[]>([]);
const activeProviderId = ref<string | null>(null);

// Diff 检测和解析
function isDiffContent(text: string): boolean {
  const lines = text.split("\n");
  const diffLineCount = lines.filter(
    (line) => line.startsWith("+ ") || line.startsWith("- ") || line.startsWith("  ") || line.startsWith("@@")
  ).length;
  // 如果超过 30% 的行是 diff 格式，认为是 diff
  return lines.length > 0 && diffLineCount / lines.length > 0.3;
}

function extractFilenameFromDetail(detail: string): string {
  // Extract filename from approval detail (first line usually has path)
  const firstLine = detail.split("\n")[0];
  // Look for common file extensions
  const match = firstLine.match(
    /([^\s]+\.(ts|tsx|js|jsx|vue|py|java|go|rs|css|scss|html|json|md|yaml|yml|toml|xml|sh|bash|sql|graphql|php|rb|swift|kt|dart|c|cpp|h|hpp))/i
  );
  return match ? match[1] : "file.txt";
}

function parseDiffLines(text: string): Array<{ text: string; type: string; lineNum: string }> {
  const lines = text.split("\n");
  let oldLineNum = 1;
  let newLineNum = 1;

  return lines.map((line) => {
    let type = "diff-ctx";
    let lineNum = "";

    if (line.startsWith("@@")) {
      // Hunk header - extract line numbers
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
      }
      type = "diff-hunk";
      lineNum = "";
    } else if (line.startsWith("+ ")) {
      type = "diff-add";
      lineNum = `+${newLineNum}`;
      newLineNum++;
    } else if (line.startsWith("- ")) {
      type = "diff-del";
      lineNum = `-${oldLineNum}`;
      oldLineNum++;
    } else if (line.startsWith(" ")) {
      type = "diff-ctx";
      lineNum = ` ${oldLineNum}`;
      oldLineNum++;
      newLineNum++;
    }

    return { text: line, type, lineNum };
  });
}

// Approval detail collapse state (track by approvalId)
const collapsedApprovals = ref<Set<string>>(new Set());

function toggleApprovalDetail(approvalId: string) {
  if (collapsedApprovals.value.has(approvalId)) {
    collapsedApprovals.value.delete(approvalId);
  } else {
    collapsedApprovals.value.add(approvalId);
  }
}

function isApprovalCollapsed(approvalId: string): boolean {
  return collapsedApprovals.value.has(approvalId);
}

// 工具参数展开/折叠：仅记录用户显式开合，未设时默认按状态（执行中展开、完成折叠）。
const toolArgsOverride = ref<Record<string, boolean>>({});

function isToolArgsOpen(part: { tool: CustomToolActivity }): boolean {
  const override = toolArgsOverride.value[part.tool.callId];
  if (override !== undefined) return override;
  return part.tool.status === "running";
}

function toggleToolArgs(part: { tool: CustomToolActivity }) {
  toolArgsOverride.value = {
    ...toolArgsOverride.value,
    [part.tool.callId]: !isToolArgsOpen(part),
  };
}

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
  maxOutputTokens: string;
  contextLimit: string;
}>({
  kind: "openai-compatible",
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  thinking: false,
  maxOutputTokens: "",
  contextLimit: "",
});

function kindLabel(kind: CustomProviderKind): string {
  if (kind === "anthropic") return "Claude";
  if (kind === "gemini") return "Gemini";
  return "OpenAI 兼容";
}

/** 表单里的数字输入是字符串：空/非法/≤0 → null（表示「未设置」），否则取四舍五入正整数。 */
function parsePositiveIntOrNull(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded > 0 ? rounded : null;
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
const activeProviderLabel = computed(() => (activeProvider.value ? providerOptionLabel(activeProvider.value) : null));
const hasActiveProvider = computed(() =>
  Boolean(
    activeProvider.value && activeProvider.value.baseUrl && activeProvider.value.apiKey && activeProvider.value.model
  )
);
function providerOptionLabel(provider: LocalCustomProvider): string {
  return `${provider.name} · ${kindLabel(provider.kind)} · ${provider.model || "未设置模型"}`;
}

function sessionSnapshot() {
  return {
    providerId: activeProviderId.value,
    providerLabel: activeProviderLabel.value,
    workspaceRoot: workspaceRoot.value,
  };
}

const canSave = computed(
  () =>
    form.value.baseUrl.trim().length > 0 && form.value.apiKey.trim().length > 0 && form.value.model.trim().length > 0
);

const canSend = computed(() => hasActiveProvider.value && !customChatStore.sending && draft.value.trim().length > 0);

// 上下文用量：已持久化历史（store 同口径估算）+ 正在输入的草稿（含一条消息固定开销 4）。
const contextUsedTokens = computed(() => {
  const draftText = draft.value.trim();
  const draftTokens = draftText ? estimateTokens(draftText) + 4 : 0;
  return customChatStore.estimatedContextTokens + draftTokens;
});

// provider 配的上下文上限（输入 tokens）；未设则回退到默认窗口（与内核 DEFAULT_CONTEXT_LIMIT 一致）。
const DEFAULT_CONTEXT_LIMIT = 200_000;
const contextLimitTokens = computed(() => activeProvider.value?.contextLimit ?? DEFAULT_CONTEXT_LIMIT);

// 输入栏展示文案：「已用 N tokens」或「已用 N / 上限 M tokens（百分比）」。
const contextUsageLabel = computed(() => {
  const used = contextUsedTokens.value;
  const limit = contextLimitTokens.value;
  if (!limit) return `上下文约 ${used.toLocaleString()} tokens`;
  const pct = Math.min(999, Math.round((used / limit) * 100));
  return `上下文约 ${used.toLocaleString()} / ${limit.toLocaleString()} tokens（${pct}%）`;
});

// 接近 / 超出上限时变色提示（超限后内核会裁掉最旧历史，仅保留最近窗口）。
const contextUsageState = computed<"normal" | "warn" | "over">(() => {
  const limit = contextLimitTokens.value;
  if (!limit) return "normal";
  const ratio = contextUsedTokens.value / limit;
  if (ratio >= 1) return "over";
  if (ratio >= 0.8) return "warn";
  return "normal";
});

// 鼠标悬停的解释：估算口径 + 超限时的裁剪行为。
const contextUsageTitle = computed(() => {
  const base = "按字符估算（CJK≈1.5、其余≈4 字符/token），含正在输入的草稿；为近似值。";
  if (!contextLimitTokens.value) return `${base}\n未设上下文上限，历史全量发送、不裁剪。`;
  if (contextUsageState.value === "over")
    return `${base}\n已超上限：发送时内核会丢弃最旧历史，仅保留最近窗口（system 与工具调用配对不拆开）。`;
  return `${base}\n超过上限时，内核会自动裁掉最旧历史。`;
});

const messagesAutoScrollSignature = computed(() =>
  customChatStore.messages
    .map((message) => {
      const partsSignature = (message.parts ?? [])
        .map((part) => {
          if (part.type === "text") return `text:${part.id}:${part.text.length}`;
          return [
            "tool",
            part.id,
            part.tool.callId,
            part.tool.status,
            part.tool.argsText.length,
            part.tool.resultText?.length ?? 0,
            part.tool.error?.length ?? 0,
          ].join(":");
        })
        .join("|");
      return [
        message.id,
        message.role,
        message.streaming ? "streaming" : "idle",
        message.content.length,
        message.reasoning?.length ?? 0,
        partsSignature,
      ].join(":");
    })
    .join("||")
);

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
    maxOutputTokens: provider.maxOutputTokens ?? null,
    contextLimit: provider.contextLimit ?? null,
  }));
  await patchUserLocalSettings({
    customProviders: {
      activeProviderId: activeProviderId.value,
      providers: plainProviders,
      workspaceRoot: workspaceRoot.value,
    },
  });
  loadFromSettings();
  await customChatStore.persistCurrentSession(sessionSnapshot());
}

async function createSession() {
  draft.value = "";
  await customChatStore.newSession(sessionSnapshot());
}

async function loadSession(id: string) {
  if (customChatStore.sending) return;
  draft.value = "";
  await customChatStore.loadSession(id);
}

async function deleteSession(id: string) {
  await customChatStore.deleteSession(id, sessionSnapshot());
}

function formatSessionTime(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function startNew() {
  editingId.value = null;
  form.value = {
    kind: "openai-compatible",
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
    thinking: false,
    maxOutputTokens: "",
    contextLimit: "",
  };
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
    maxOutputTokens: provider.maxOutputTokens != null ? String(provider.maxOutputTokens) : "",
    contextLimit: provider.contextLimit != null ? String(provider.contextLimit) : "",
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
    maxOutputTokens: parsePositiveIntOrNull(form.value.maxOutputTokens),
    contextLimit: parsePositiveIntOrNull(form.value.contextLimit),
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
  void customChatStore.send(text, {
    providerId,
    providerLabel: activeProviderLabel.value,
    workspaceRoot: workspaceRoot.value,
  });
}

async function cancelGeneration() {
  const success = await customChatStore.cancelCurrentRun();
  if (!success) {
    console.warn("取消失败");
  }
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

function toolStatusLabel(status: CustomToolActivity["status"]): string {
  if (status === "running") return "执行中";
  if (status === "error") return "失败";
  return "完成";
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

// 残缺 JSON 增量里的转义序列还原为可读字符（流式期间 parse 不出整串时用）。
function unescapeJsonFragment(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

// 工具入参的多行预览：JSON 完整时优先展示 content 大文本，否则美化整串；
// 流式残缺 JSON parse 失败时，反转义原始串增量地多行展示（无需等 JSON 闭合）。
function toolArgsPreview(argsText: string): string {
  const text = String(argsText ?? "").trim();
  if (!text) return "";
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      if (typeof obj.content === "string") return obj.content;
      return JSON.stringify(obj, null, 2);
    }
  } catch {
    // 流式残缺 JSON：反转义后多行展示
  }
  return unescapeJsonFragment(text);
}

// 是否值得显示多行展开体：一行装不下（含换行或超 80 字符）才显示，短参数保持单行清爽。
function toolHasPreview(argsText: string): boolean {
  const preview = toolArgsPreview(argsText);
  return preview.includes("\n") || preview.length > 80;
}

function onComposerKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}

function scrollMessagesToBottom() {
  const element = listRef.value;
  if (!element) return;
  element.scrollTop = element.scrollHeight;
}

function scheduleScrollMessagesToBottom() {
  if (scrollToBottomRafId !== null) return;
  scrollToBottomRafId = window.requestAnimationFrame(() => {
    scrollToBottomRafId = null;
    void nextTick(() => {
      scrollMessagesToBottom();
    });
  });
}

watch(messagesAutoScrollSignature, scheduleScrollMessagesToBottom, { flush: "post" });

onMounted(() => {
  loadFromSettings();
  showConfig.value = !hasActiveProvider.value;
  if (providers.value.length === 0) startNew();
  void customChatStore.initSessions(sessionSnapshot());
});

onBeforeUnmount(() => {
  if (scrollToBottomRafId !== null) {
    window.cancelAnimationFrame(scrollToBottomRafId);
    scrollToBottomRafId = null;
  }
});
</script>

<style scoped>
.custom-workbench {
  display: flex;
  height: 100%;
  min-height: 0;
  color: var(--text);
  background: var(--bg);
}

.cw-main {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.cw-sessions {
  width: 244px;
  min-width: 220px;
  border-right: 1px solid var(--border);
  background: var(--surface-1);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.cw-sessions__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}

.cw-btn--compact {
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 7px;
}

.cw-sessions__empty {
  padding: 14px 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.cw-session-list {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  overflow: auto;
}

.cw-session {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  align-items: center;
  gap: 6px;
  min-height: 62px;
  padding: 7px 7px 7px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  box-sizing: border-box;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease;
}

.cw-session.is-active {
  border-color: var(--border-accent);
  background: color-mix(in srgb, var(--bg-accent-soft) 82%, var(--surface-1) 18%);
  box-shadow: inset 3px 0 0 var(--fg-accent);
}

.cw-session:hover {
  border-color: var(--border-accent);
  background: color-mix(in srgb, var(--bg-accent-soft) 62%, var(--surface-1) 38%);
}

.cw-session__main {
  min-width: 0;
  width: 100%;
  height: auto;
  min-height: 46px;
  cursor: pointer;
  border: 0;
  background: transparent;
  color: var(--text);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  gap: 4px;
  padding: 0;
  text-align: left;
  font: inherit;
  line-height: 1.35;
  appearance: none;
  box-sizing: border-box;
  overflow: hidden;
}

.cw-session__main:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.cw-session__title {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  letter-spacing: 0;
}

.cw-session__meta,
.cw-session__provider {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 500;
  line-height: 15px;
  letter-spacing: 0;
  color: var(--text-muted);
}

.cw-session__delete {
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 18px;
  line-height: 1;
  opacity: 0.72;
  transition:
    opacity 140ms ease,
    color 140ms ease,
    background 140ms ease;
}

.cw-session:hover .cw-session__delete,
.cw-session__delete:focus-visible {
  opacity: 1;
}

.cw-session__delete:hover:not(:disabled) {
  color: var(--fg-danger);
  background: var(--bg-danger-soft);
}

.cw-session__delete:disabled {
  cursor: not-allowed;
  opacity: 0.45;
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

.cw-btn--danger {
  color: var(--fg-danger);
  border-color: var(--border-danger);
  background: var(--bg-danger-soft);
}

.cw-btn--danger:hover:not(:disabled) {
  border-color: var(--border-danger-hover);
  background: color-mix(in srgb, var(--bg-danger-soft) 80%, var(--fg-danger) 20%);
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
  min-height: 40px;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  line-height: 20px;
}

.cw-field select {
  height: 40px;
  padding-top: 0;
  padding-bottom: 0;
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

.cw-chat-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.cw-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
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

.cw-msg__parts {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  position: relative;
  overflow: hidden;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}

.cw-tool::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
}

.cw-tool--running {
  border-color: var(--border-accent);
  background: color-mix(in srgb, var(--surface-2) 88%, var(--bg-accent-soft) 12%);
  box-shadow: inset 2px 0 0 var(--fg-accent);
}

.cw-tool--running::before {
  background: linear-gradient(90deg, transparent 0%, rgb(from var(--accent) r g b / 0.1) 45%, transparent 82%);
  opacity: 1;
  transform: translateX(-110%);
  animation: cw-tool-scan 1.35s ease-in-out infinite;
}

.cw-tool--done {
  border-color: var(--border-success);
  background: color-mix(in srgb, var(--surface-2) 90%, var(--bg-success-soft) 10%);
  box-shadow: inset 2px 0 0 var(--fg-success);
  animation: cw-tool-complete 220ms ease-out;
}

.cw-tool--error {
  border-color: var(--border-danger);
  background: color-mix(in srgb, var(--surface-2) 88%, var(--bg-danger-soft) 12%);
  box-shadow: inset 2px 0 0 var(--fg-danger);
}

.cw-tool__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.cw-tool__icon {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 50%;
  position: relative;
}

.cw-tool__icon--running {
  border: 2px solid var(--border-accent);
  border-top-color: var(--fg-accent);
  animation: cw-tool-spin 760ms linear infinite;
}

.cw-tool__icon--done {
  color: var(--fg-success);
  background: var(--bg-success-soft);
  border: 1px solid var(--border-success);
  animation: cw-tool-pop 220ms ease-out;
}

.cw-tool__icon--done::before {
  content: "";
  width: 7px;
  height: 4px;
  border-left: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: translateY(-1px) rotate(-45deg);
}

.cw-tool__icon--error {
  color: var(--fg-danger);
  background: var(--bg-danger-soft);
  border: 1px solid var(--border-danger);
}

.cw-tool__icon--error::before,
.cw-tool__icon--error::after {
  content: "";
  position: absolute;
  width: 8px;
  height: 2px;
  border-radius: 999px;
  background: currentColor;
}

.cw-tool__icon--error::before {
  transform: rotate(45deg);
}

.cw-tool__icon--error::after {
  transform: rotate(-45deg);
}

.cw-tool__status {
  width: 42px;
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.cw-tool--running .cw-tool__status {
  color: var(--fg-accent);
}

.cw-tool--done .cw-tool__status {
  color: var(--fg-success);
}

.cw-tool--error .cw-tool__status {
  color: var(--fg-danger);
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

/* 流式参数预览：执行中展开看正在写入的内容，完成后折叠回单行摘要 */
.cw-tool__args-preview {
  margin-top: 4px;
}

.cw-tool__args-toggle {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  user-select: none;
  transition: color 0.15s ease;
}

.cw-tool__args-toggle:hover {
  color: var(--text);
}

.cw-tool__args-body {
  margin: 6px 0 0;
  padding: 6px 8px;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  border-radius: 6px;
  color: var(--text);
  background: var(--surface-3);
}

@keyframes cw-tool-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes cw-tool-scan {
  0% {
    transform: translateX(-110%);
  }

  58%,
  100% {
    transform: translateX(110%);
  }
}

@keyframes cw-tool-pop {
  0% {
    transform: scale(0.82);
  }

  100% {
    transform: scale(1);
  }
}

@keyframes cw-tool-complete {
  0% {
    box-shadow:
      inset 2px 0 0 var(--fg-success),
      0 0 0 0 rgb(from var(--success) r g b / 0.22);
  }

  100% {
    box-shadow:
      inset 2px 0 0 var(--fg-success),
      0 0 0 7px rgb(from var(--success) r g b / 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cw-tool,
  .cw-tool::before,
  .cw-tool__icon {
    animation: none !important;
    transition: none;
  }
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

.cw-approval__toggle {
  margin-left: auto;
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 10px;
  transition: color 0.15s ease;
  user-select: none;
}

.cw-approval__toggle:hover {
  color: var(--text);
}

.cw-approval__toggle:active {
  transform: scale(0.95);
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

.cw-approval__diff {
  margin: 0;
  padding: 0;
  max-height: 300px;
  overflow-y: auto;
  font-size: 12px;
  border-radius: 6px;
  background: var(--ui-code-bg);
  border: 1px solid var(--ui-code-border);
}

.diff-line {
  display: flex;
  margin: 0;
  font-family: ui-monospace, "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace;
  line-height: 1.5;
}

.diff-line-num {
  flex-shrink: 0;
  width: 50px;
  padding: 0 8px;
  text-align: right;
  color: var(--text-muted);
  background: var(--surface-1);
  border-right: 1px solid var(--border);
  user-select: none;
  font-size: 11px;
}

.diff-line-content {
  flex: 1;
  padding: 0 8px;
  white-space: pre-wrap;
  word-break: break-word;
}

.cw-approval__diff .diff-add {
  background-color: var(--bg-success-soft);
  color: var(--fg-success);
}

.cw-approval__diff .diff-del {
  background-color: var(--bg-danger-soft);
  color: var(--fg-danger);
}

.cw-approval__diff .diff-ctx {
  color: var(--text-muted);
}

.cw-approval__diff .diff-hunk {
  background: var(--surface-2);
  color: var(--text-muted);
  font-weight: 500;
}

.cw-approval__diff-viewer {
  max-height: 400px;
  overflow-y: auto;
  border-radius: 6px;
  background: var(--ui-code-bg);
  border: 1px solid var(--ui-code-border);
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

/* 上下文用量指示：默认柔和，接近上限转警告色，超限转危险色 */
.cw-context {
  display: inline-flex;
  align-items: center;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  cursor: default;
}

.cw-context--warn {
  color: var(--fg-warning);
}

.cw-context--over {
  color: var(--fg-danger);
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
  display: flex;
  align-items: center;
  gap: 8px;
}

.cw-think__status {
  font-size: 11px;
  color: var(--fg-accent);
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
