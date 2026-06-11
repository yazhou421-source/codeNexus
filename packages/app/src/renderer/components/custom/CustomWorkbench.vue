<template>
  <div class="custom-workbench">
    <aside class="cw-sessions">
      <div class="cw-sessions__head">
        <strong>Custom 会话</strong>
        <button
          type="button"
          class="cw-btn cw-btn--compact cw-btn--primary"
          :disabled="customChatStore.sending"
          @click="createSession"
        >
          + 新建
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
          <button
            type="button"
            class="cw-btn"
            :class="{ 'is-on': runtimeStore.timelineDebugEnabled }"
            :aria-pressed="runtimeStore.timelineDebugEnabled ? 'true' : 'false'"
            @click="runtimeStore.toggleTimelineDebugEnabled()"
          >
            <ScrollText class="cw-btn__icon" aria-hidden="true" />
            日志
          </button>
          <button
            type="button"
            class="cw-btn"
            :class="{ 'is-on': showConfig }"
            :aria-pressed="showConfig ? 'true' : 'false'"
            @click="showConfig = !showConfig"
          >
            <Settings2 class="cw-btn__icon" aria-hidden="true" />
            配置 Provider
          </button>
          <button
            type="button"
            class="cw-btn cw-btn--ghost cw-header__mode-switch"
            @click="appShellStore.openModeChooser()"
          >
            <ArrowRightLeft class="cw-btn__icon" aria-hidden="true" />
            切换模式
          </button>
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
                class="cw-btn cw-btn--accent"
                @click="activate(provider.id)"
              >
                激活
              </button>
              <span v-else class="cw-provider__current">当前</span>
              <button type="button" class="cw-btn" @click="edit(provider)">编辑</button>
              <button type="button" class="cw-btn cw-btn--danger cw-provider__remove" @click="remove(provider.id)">
                删除
              </button>
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
            <div class="cw-config__actions-commit">
              <button type="button" class="cw-btn" @click="cancelEdit">取消</button>
              <button type="submit" class="cw-btn cw-btn--primary" :disabled="!canSave">保存并激活</button>
            </div>
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
                思考过程
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
                <div
                  v-else
                  class="cw-tool"
                  :class="[
                    `cw-tool--${part.tool.status}`,
                    `cw-tool--cat-${toolCategory(part.tool.name)}`,
                    { 'is-open': toolHasDetail(part) && isToolDetailOpen(part) },
                  ]"
                >
                  <component
                    :is="toolHasDetail(part) ? 'button' : 'div'"
                    class="cw-tool__row"
                    :class="{ 'is-clickable': toolHasDetail(part) }"
                    :type="toolHasDetail(part) ? 'button' : undefined"
                    :aria-expanded="toolHasDetail(part) ? (isToolDetailOpen(part) ? 'true' : 'false') : undefined"
                    @click="toolHasDetail(part) && toggleToolDetail(part)"
                  >
                    <component :is="toolIcon(part.tool.name)" class="cw-tool__cat-icon" aria-hidden="true" />
                    <span class="cw-tool__name mono">{{ part.tool.name }}</span>
                    <span v-if="toolArgsSummary(part.tool.argsText)" class="cw-tool__sep" aria-hidden="true">·</span>
                    <span class="cw-tool__args mono">{{ toolArgsSummary(part.tool.argsText) }}</span>
                    <span
                      class="cw-tool__state"
                      :class="`cw-tool__state--${part.tool.status}`"
                      :title="toolStatusLabel(part.tool.status)"
                    >
                      <span
                        v-if="part.tool.status === 'running'"
                        class="cw-tool__spinner"
                        :aria-label="toolStatusLabel(part.tool.status)"
                        role="img"
                      ></span>
                      <span
                        v-else-if="part.tool.status === 'done'"
                        class="cw-tool__check"
                        role="img"
                        aria-label="完成"
                      ></span>
                      <X v-else class="cw-tool__err-icon" role="img" aria-label="失败" />
                    </span>
                    <ChevronDown
                      v-if="toolHasDetail(part)"
                      class="cw-tool__chevron"
                      :class="{ 'is-open': isToolDetailOpen(part) }"
                      aria-hidden="true"
                    />
                  </component>
                  <div v-if="toolHasDetail(part)" v-show="isToolDetailOpen(part)" class="cw-tool__detail-panel">
                    <template v-if="toolHasPreview(part.tool.argsText)">
                      <div class="cw-tool__detail-label">参数</div>
                      <pre class="cw-tool__detail-body mono">{{ toolArgsPreview(part.tool.argsText) }}</pre>
                    </template>
                    <template v-if="part.tool.resultText || part.tool.error">
                      <div class="cw-tool__detail-label" :class="{ 'is-error': part.tool.error }">
                        {{ part.tool.error ? "错误" : "结果" }}
                      </div>
                      <pre class="cw-tool__detail-body mono" :class="{ 'is-error': part.tool.error }">{{
                        part.tool.error || part.tool.resultText
                      }}</pre>
                    </template>
                  </div>
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
                  :aria-expanded="isApprovalCollapsed(ap.approvalId) ? 'false' : 'true'"
                >
                  <ChevronDown
                    class="cw-approval__chevron"
                    :class="{ 'is-open': !isApprovalCollapsed(ap.approvalId) }"
                    aria-hidden="true"
                  />
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
                <button
                  type="button"
                  class="cw-btn cw-btn--ghost-danger"
                  @click="customChatStore.respondApproval(ap.approvalId, false)"
                >
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
          <div v-else class="cw-shell" :class="{ 'is-sending': customChatStore.sending }">
            <textarea
              ref="composerInputRef"
              v-model="draft"
              class="cw-shell__input app-scrollbar"
              :style="composerSizeStyle"
              placeholder="给自定义模型发消息…（Enter 发送，Shift+Enter 换行）"
              :disabled="customChatStore.sending"
              @keydown="onComposerKeydown"
              @input="onComposerInput"
            ></textarea>
            <div class="cw-shell__bar">
              <div class="cw-shell__left">
                <SelectDropdown
                  class="cw-model-select"
                  :modelValue="activeProviderId ?? ''"
                  :options="providerSelectOptions"
                  :disabled="customChatStore.sending"
                  ariaLabel="选择 Provider"
                  :minPopoverWidth="260"
                  @update:modelValue="onProviderPick"
                />
                <button
                  type="button"
                  class="cw-tool-chip"
                  :class="{ 'is-set': !!workspaceRoot }"
                  :title="workspaceRoot || '未选择工作区（使用系统工具，根目录为进程 cwd）'"
                  @click="selectWorkspace"
                >
                  <FolderOpen v-if="workspaceRoot" class="cw-tool-chip__icon" aria-hidden="true" />
                  <Folder v-else class="cw-tool-chip__icon" aria-hidden="true" />
                  <span class="cw-tool-chip__label">{{ workspaceShortName || "工作区" }}</span>
                  <span
                    v-if="workspaceRoot"
                    class="cw-tool-chip__clear"
                    role="button"
                    aria-label="清除工作区"
                    @click.stop="clearWorkspace"
                  >
                    <X class="cw-tool-chip__clear-icon" aria-hidden="true" />
                  </span>
                </button>
              </div>
              <div class="cw-shell__right">
                <span
                  class="cw-context-chip"
                  :class="`cw-context-chip--${contextUsageState}`"
                  :title="contextUsageTitle"
                >
                  <span class="cw-context-blocks" aria-hidden="true">
                    <span
                      v-for="i in CONTEXT_BLOCK_COUNT"
                      :key="i"
                      class="cw-context-blocks__cell"
                      :class="{ 'is-on': i <= contextBlocksOn }"
                    ></span>
                  </span>
                  <span class="cw-context-chip__label">{{ contextCompactLabel }}</span>
                </span>
                <button
                  v-if="customChatStore.sending"
                  type="button"
                  class="cw-send-btn cw-send-btn--stop"
                  aria-label="停止生成"
                  @click="cancelGeneration"
                >
                  <Square class="cw-send-btn__icon" aria-hidden="true" />
                </button>
                <button v-else type="button" class="cw-send-btn" aria-label="发送" :disabled="!canSend" @click="submit">
                  <ArrowUp class="cw-send-btn__icon" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowRightLeft,
  ArrowUp,
  ChevronDown,
  Download,
  FileDiff,
  FilePlus,
  FileSearch,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Globe,
  Pencil,
  ScrollText,
  Search,
  Settings2,
  Square,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-vue-next";
import type { Component } from "vue";
import { codexDesktop } from "../../api/codexDesktopClient";
import AgentMarkdownContent from "../ui/AgentMarkdownContent.vue";
import ExecutionWaveText from "../ui/ExecutionWaveText.vue";
import SelectDropdown from "../ui/SelectDropdown.vue";
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
const composerInputRef = ref<HTMLTextAreaElement | null>(null);
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

// 工具详情展开/折叠：单行右侧点击展开，统一展示「参数 + 结果/错误」。
// 仅记录用户显式开合，未设时默认按状态（执行中展开看进度、完成/失败折叠）。
const toolDetailOverride = ref<Record<string, boolean>>({});

// 该工具是否有可展开的详情：可预览参数 OR 有结果/错误。
function toolHasDetail(part: { tool: CustomToolActivity }): boolean {
  return toolHasPreview(part.tool.argsText) || Boolean(part.tool.resultText) || Boolean(part.tool.error);
}

function isToolDetailOpen(part: { tool: CustomToolActivity }): boolean {
  const override = toolDetailOverride.value[part.tool.callId];
  if (override !== undefined) return override;
  return part.tool.status === "running";
}

function toggleToolDetail(part: { tool: CustomToolActivity }) {
  toolDetailOverride.value = {
    ...toolDetailOverride.value,
    [part.tool.callId]: !isToolDetailOpen(part),
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

// SelectDropdown 选项：value=provider.id，label=完整标签。
const providerSelectOptions = computed(() =>
  providers.value.map((provider) => ({ value: provider.id, label: providerOptionLabel(provider) }))
);

// 工作区末段目录名（用于工具栏芯片紧凑展示，完整路径挂 title）。
const workspaceShortName = computed(() => {
  const root = workspaceRoot.value;
  if (!root) return "";
  const segments = root.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || root;
});

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

// 接近 / 超出上限时变色提示（超限后内核会裁掉最旧历史，仅保留最近窗口）。
const contextUsageState = computed<"normal" | "warn" | "over">(() => {
  const limit = contextLimitTokens.value;
  if (!limit) return "normal";
  const ratio = contextUsedTokens.value / limit;
  if (ratio >= 1) return "over";
  if (ratio >= 0.8) return "warn";
  return "normal";
});

// 进度环百分比（0–100，封顶 100）；无上限时回 0（环画成空，文案仅显示用量）。
const contextUsagePercent = computed(() => {
  const limit = contextLimitTokens.value;
  if (!limit) return 0;
  return Math.min(100, Math.round((contextUsedTokens.value / limit) * 100));
});

// 进度展示用的像素分段块条：5 格，按封顶百分比向上取整点亮（有用量时至少亮 1 格）。
const CONTEXT_BLOCK_COUNT = 5;
const contextBlocksOn = computed(() => {
  const pct = contextUsagePercent.value;
  if (pct === 0) return 0;
  return Math.max(1, Math.ceil((pct / 100) * CONTEXT_BLOCK_COUNT));
});

// 紧凑 token 文案：≥1000 显示 x.xk，否则原值。
function formatCompactTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return String(n);
}

// 工具栏芯片用的紧凑用量文案。
const contextCompactLabel = computed(() => formatCompactTokens(contextUsedTokens.value));

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

// SelectDropdown 回调：直接收 provider id（sending 时忽略，避免运行中切换）。
async function onProviderPick(id: string) {
  const next = id.trim();
  if (!next || next === activeProviderId.value || customChatStore.sending) return;
  await activate(next);
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
  resetComposerHeight();
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

// 工具按语义分 5 类：读 / 写 / 删 / 执行 / 网络（其余归 other）。
// 类别决定行内图标 + 语义色调（read=accent、write=success、destructive=danger、
// exec=warning、network=accent、other=muted）；与卡片三态色（running/done/error）叠加。
type ToolCategory = "read" | "write" | "destructive" | "exec" | "network" | "other";

const TOOL_CATEGORY_BY_NAME: Record<string, ToolCategory> = {
  read_file: "read",
  read_file_range: "read",
  search_files: "read",
  grep: "read",
  git_status: "read",
  git_diff: "read",
  git_show: "read",
  write_file: "write",
  edit_file: "write",
  apply_patch: "write",
  mkdir: "write",
  move_file: "write",
  delete_file: "destructive",
  run_command: "exec",
  web_search: "network",
  web_fetch: "network",
};

const TOOL_ICON_BY_NAME: Record<string, Component> = {
  read_file: FileText,
  read_file_range: FileText,
  search_files: FileSearch,
  grep: Search,
  git_status: GitBranch,
  git_diff: FileDiff,
  git_show: GitBranch,
  write_file: FilePlus,
  edit_file: Pencil,
  apply_patch: FileDiff,
  mkdir: FolderPlus,
  move_file: ArrowRightLeft,
  delete_file: Trash2,
  run_command: Terminal,
  web_search: Globe,
  web_fetch: Download,
};

function toolCategory(name: string): ToolCategory {
  return TOOL_CATEGORY_BY_NAME[name] ?? "other";
}

function toolIcon(name: string): Component {
  return TOOL_ICON_BY_NAME[name] ?? Wrench;
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

// textarea 自动增高：内容增长时撑高，到上限（约 8 行）后内部滚动。
// 高度边界只在这里定义，模板内联样式引用，避免与 CSS 各存一份漂移。
const COMPOSER_MIN_HEIGHT = 48;
const COMPOSER_MAX_HEIGHT = 200;
const composerSizeStyle = {
  height: `${COMPOSER_MIN_HEIGHT}px`,
  maxHeight: `${COMPOSER_MAX_HEIGHT}px`,
};
function autoGrowComposer() {
  const el = composerInputRef.value;
  if (!el) return;
  el.style.height = "auto";
  const next = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, el.scrollHeight));
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
}

function resetComposerHeight() {
  const el = composerInputRef.value;
  if (!el) return;
  el.style.height = `${COMPOSER_MIN_HEIGHT}px`;
  el.style.overflowY = "hidden";
}

function onComposerInput() {
  autoGrowComposer();
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
  /* 像素皮肤原语：颜色一律从当前主题 token 派生，跟随主题切换 */
  --px-bw: 2px;
  --px-shadow-color: color-mix(in srgb, var(--text) 22%, var(--bg));
  --px-shadow: 3px 3px 0 0 var(--px-shadow-color);
  --px-shadow-sm: 2px 2px 0 0 var(--px-shadow-color);
  --cw-font-content: var(--ui-font, var(--sans));
  --composer-shell-focus-ring: transparent;
  position: relative;
  display: flex;
  height: 100%;
  min-height: 0;
  font-family: var(--ui-font, var(--sans));
  font-size: 13px;
  line-height: 20px;
  color: var(--text);
  background: var(--bg);
}

/* 静态 CRT 扫描线：极淡、不动画，reduced-motion 安全 */
.custom-workbench::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    color-mix(in srgb, var(--text) 3%, transparent) 0 1px,
    transparent 1px 3px
  );
}

/* 全局按钮基线是 3px 圆角，本页整体拍平成方角 */
.custom-workbench button {
  border-radius: 0;
}

/* 页内滚动条方角化（颜色 token 不动） */
.app-scrollbar::-webkit-scrollbar-thumb,
.app-scrollbar::-webkit-scrollbar-track,
.app-scrollbar::-webkit-scrollbar-track-piece {
  border-radius: 0;
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
  border-right: var(--px-bw) solid var(--border);
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
  border-bottom: var(--px-bw) solid var(--border);
}

.cw-btn--compact {
  padding: 2px 8px;
}

.cw-sessions__empty {
  margin: 14px 12px;
  padding: 12px;
  font-size: 12px;
  color: var(--text-muted);
  border: var(--px-bw) dashed var(--border);
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
  border-radius: 0;
  border: var(--px-bw) solid transparent;
  background: transparent;
  box-sizing: border-box;
}

.cw-session.is-active {
  border-color: var(--border-accent);
  background: color-mix(in srgb, var(--bg-accent-soft) 82%, var(--surface-1) 18%);
  box-shadow: var(--px-shadow-sm);
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
  font-size: 12px;
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
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
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
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  opacity: 0.72;
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
  border-bottom: var(--px-bw) solid var(--border);
}

.cw-header__title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cw-header__title strong {
  font-size: 24px;
  line-height: 28px;
  font-weight: 400;
}

.cw-tag {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 0;
  border: var(--px-bw) solid var(--border);
  color: var(--text-muted);
  background: var(--surface-3);
}

.cw-header__actions {
  display: flex;
  gap: 8px;
}

.cw-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  cursor: pointer;
  font-size: 12px;
  line-height: 18px;
  padding: 4px 12px;
  border-radius: 0;
  border: var(--px-bw) solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  box-shadow: var(--px-shadow-sm);
  transition: none;
}

.cw-btn__icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.cw-btn:hover:not(:disabled) {
  border-color: var(--border-accent);
  background: var(--surface-3);
}

/* 经典像素按压：整体位移 + 阴影收没 */
.cw-btn:active:not(:disabled) {
  transform: translate(2px, 2px);
  box-shadow: none;
}

.cw-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 开关按钮的持久按下态（header 日志 / 配置 Provider） */
.cw-btn.is-on {
  transform: translate(2px, 2px);
  box-shadow: none;
  border-color: var(--border-accent);
  background: var(--bg-accent-soft);
  color: var(--fg-accent);
}

.cw-btn--primary {
  color: var(--fg-success);
  border-color: var(--border-success);
  background: var(--bg-success-soft);
}

.cw-btn--primary:hover:not(:disabled) {
  border-color: var(--border-success-hover);
  background: var(--bg-success-soft);
}

.cw-btn--accent {
  color: var(--fg-accent);
  border-color: var(--border-accent);
  background: var(--bg-accent-soft);
}

.cw-btn--accent:hover:not(:disabled) {
  background: var(--bg-accent-soft);
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

/* danger ghost：危险文字 + 中性底，用于审批「拒绝」这类需要可读但不抢眼的破坏性操作 */
.cw-btn--ghost-danger {
  color: var(--fg-danger);
}

.cw-btn--ghost-danger:hover:not(:disabled) {
  border-color: var(--border-danger);
  background: var(--bg-danger-soft);
}

/* ghost：无底无影，用于导航类次要动作（header 切换模式） */
.cw-btn--ghost {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  color: var(--text-muted);
}

.cw-btn--ghost:hover:not(:disabled) {
  border-color: var(--border-accent);
  background: transparent;
  color: var(--text);
}

.cw-btn--ghost:active:not(:disabled) {
  transform: none;
}

/* 与左侧两个开关按钮之间的分隔线：ghost 无边框，单独亮出左边线 */
.cw-header__mode-switch {
  margin-left: 4px;
  padding-left: 12px;
  border-left: var(--px-bw) solid var(--border);
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
  font-size: 24px;
  line-height: 28px;
  font-weight: 400;
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
  border-radius: 0;
  border: var(--px-bw) solid var(--border);
  background: var(--surface-2);
  box-shadow: var(--px-shadow);
}

.cw-provider.is-active {
  border-color: var(--border-success);
  background: var(--bg-success-soft);
  box-shadow: 3px 3px 0 0 color-mix(in srgb, var(--fg-success) 35%, var(--bg));
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
  font-size: 12px;
  padding: 0 6px;
  border-radius: 0;
  border: 1px solid var(--border);
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

/* 破坏性操作与常规操作拉开间距 */
.cw-provider__remove {
  margin-left: 6px;
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
  border-top: var(--px-bw) solid var(--border);
}

.cw-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.cw-field input,
.cw-field select {
  padding: 8px 10px;
  min-height: 40px;
  box-sizing: border-box;
  border-radius: 0;
  border: var(--px-bw) solid var(--border);
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

/* 凹槽态：边框变 accent + 内嵌硬阴影，与按钮的凸起形成对偶 */
.cw-field input:focus,
.cw-field select:focus {
  outline: none;
  border-color: var(--border-accent);
  box-shadow: inset 2px 2px 0 0 color-mix(in srgb, var(--text) 10%, transparent);
}

.cw-config__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 提交组右对齐，主操作收尾；测试连接（工具类）留在左侧 */
.cw-config__actions-commit {
  display: flex;
  gap: 8px;
  margin-left: auto;
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
  padding: 14px 20px;
  font-size: 12px;
  text-align: center;
  color: var(--text-muted);
  border: var(--px-bw) dashed var(--border);
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
  font-size: 12px;
  color: var(--text-muted);
}

.cw-msg__body {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 20px;
  padding: 10px 12px;
  border-radius: 0;
  color: var(--text);
  background: var(--surface-2);
  border: var(--px-bw) solid var(--border);
  box-shadow: var(--px-shadow);
}

/* 用户气泡右对齐，阴影落向左下；与助手气泡的右下阴影形成方向区分 */
.cw-msg--user .cw-msg__body {
  border-color: var(--border-accent);
  background: var(--bg-accent-soft);
  box-shadow: -3px 3px 0 0 var(--px-shadow-color);
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

/* markdown 正文走独立字体 token，避免长文继承实验性界面字体 */
.custom-workbench :deep(.agent-markdown-body) {
  font-family: var(--cw-font-content);
  font-size: 13px;
  line-height: 20px;
}

.cw-msg__parts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cw-composer {
  border-top: 1px solid var(--border);
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: color-mix(in srgb, var(--surface-1) 92%, transparent);
}

.cw-composer__warn {
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

/* 融合输入外壳：textarea 在上，底部一条工具栏内嵌模型/工作区/上下文/发送 */
.cw-shell {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-xl);
  border: 1px solid var(--composer-shell-border, var(--border));
  background: var(--composer-shell-bg, var(--surface-2));
  box-shadow: 0 8px 24px color-mix(in srgb, var(--bg) 26%, transparent);
  overflow: hidden;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease;
}

.cw-shell:focus-within {
  border-color: var(--composer-shell-focus-border, var(--border-accent));
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent),
    0 10px 28px color-mix(in srgb, var(--bg) 30%, transparent);
}

.cw-shell.is-sending {
  opacity: 0.96;
}

.cw-shell__input {
  resize: none;
  padding: 12px 14px 8px;
  border: 0;
  background: transparent;
  color: var(--composer-input-text, var(--text));
  font-family: var(--ui-font, var(--sans));
  font-size: 13px;
  line-height: 20px;
  overflow-y: hidden;
}

.cw-shell__input::placeholder {
  color: var(--composer-input-placeholder, var(--text-muted));
}

.cw-shell__input:focus {
  outline: none;
}

.cw-shell__input:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.cw-shell__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 10px;
  border-top: 1px solid var(--composer-divider, var(--border));
  background: color-mix(in srgb, var(--surface-1) 58%, transparent);
}

.cw-shell__left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.cw-shell__right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

/* SelectDropdown trigger 融入工具栏：压扁高度、紧凑内边距 */
.cw-model-select :deep(.ui-select-trigger),
.cw-model-select.ui-select-trigger {
  height: 28px;
  max-width: min(360px, 42vw);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--composer-select-border, var(--border));
  background: var(--composer-select-bg, var(--surface-2));
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background 140ms ease;
  box-shadow: none;
}

.cw-model-select :deep(.ui-select-value) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cw-model-select :deep(.ui-select-trigger:hover:not(:disabled)) {
  border-color: var(--composer-select-hover-border, var(--border-accent));
  background: var(--composer-select-hover-bg, var(--surface-3));
}

.cw-model-select :deep(.ui-select-trigger:disabled) {
  cursor: not-allowed;
  opacity: 0.62;
}

/* 工具栏芯片（工作区） */
.cw-tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  max-width: 200px;
  padding: 0 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--composer-chip-border, var(--border));
  background: var(--composer-chip-bg, var(--surface-2));
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    color 140ms ease;
}

.cw-tool-chip:hover {
  border-color: var(--border-accent);
  background: var(--composer-chip-hover-bg, var(--surface-3));
  color: var(--text);
}

.cw-tool-chip.is-set {
  color: var(--text);
}

.cw-tool-chip__icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.cw-tool-chip__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cw-tool-chip__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

.cw-tool-chip__clear:hover {
  color: var(--fg-danger);
  background: var(--bg-danger-soft);
}

.cw-tool-chip__clear-icon {
  width: 11px;
  height: 11px;
}

/* 上下文用量芯片 + 分段用量条 */
.cw-context-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 4px;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: default;
}

.cw-context-chip--warn {
  color: var(--fg-warning);
}

.cw-context-chip--over {
  color: var(--fg-danger);
}

.cw-context-blocks {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.cw-context-blocks__cell {
  width: 4px;
  height: 10px;
  border-radius: 1px;
  background: var(--border);
}

/* 点亮格随 currentColor 走，warn/over 时跟着芯片一起变色 */
.cw-context-blocks__cell.is-on {
  background: currentColor;
}

.cw-context-chip__label {
  line-height: 1;
}

/* 发送 / 停止图标按钮 */
.cw-send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-success);
  background: var(--bg-success-soft);
  color: var(--fg-success);
  cursor: pointer;
  box-shadow: none;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    transform 140ms ease;
}

.cw-send-btn:hover:not(:disabled) {
  border-color: var(--border-success-hover);
}

.cw-send-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.cw-send-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.cw-send-btn--stop {
  border-color: var(--border-danger);
  background: var(--bg-danger-soft);
  color: var(--fg-danger);
}

.cw-send-btn--stop:hover {
  border-color: var(--border-danger-hover);
}

.cw-send-btn__icon {
  width: 18px;
  height: 18px;
}

/* 工具活动：轻量行内式 —— 一行一个工具，类别图标 + 名称 + 参数摘要 + 右侧状态点 */
.cw-tool {
  border-radius: 0;
  border: var(--px-bw) solid var(--border);
  padding: 3px 6px;
  font-size: 12px;
  transition: none;
}

/* 行内主体：图标 / 名称 / 分隔点 / 参数 / 状态指示 / 展开箭头，单行对齐 */
.cw-tool__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  width: 100%;
  line-height: 18px;
  /* 作为 <button> 时复位原生样式，仍继承字号/颜色 */
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.cw-tool__row.is-clickable {
  cursor: pointer;
}

.cw-tool__row.is-clickable:focus-visible {
  outline: 2px solid var(--border-accent);
  outline-offset: 2px;
  border-radius: 0;
}

/* 类别图标：默认随类别染色（see cat 规则），执行中/失败时被状态色覆盖 */
.cw-tool__cat-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.cw-tool__name {
  color: var(--text);
  font-weight: 600;
  flex-shrink: 0;
}

.cw-tool__sep {
  color: var(--text-muted);
  flex-shrink: 0;
  opacity: 0.6;
}

.cw-tool__args {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* 右侧状态指示：执行中转圈、完成对勾、失败 × —— 顶到行尾 */
.cw-tool__state {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

/* 像素 spinner：实心方块按 45° 阶跳旋转 */
.cw-tool__spinner {
  width: 10px;
  height: 10px;
  border-radius: 0;
  background: var(--fg-accent);
  animation: cw-px-spin 1s steps(8) infinite;
}

.cw-tool__check {
  position: relative;
  width: 12px;
  height: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-success);
}

/* 字形对勾：继承像素字体，比旋转边框画的勾更贴风格 */
.cw-tool__check::before {
  content: "✓";
  font-size: 12px;
  line-height: 1;
}

.cw-tool__err-icon {
  width: 12px;
  height: 12px;
  color: var(--fg-danger);
}

/* 类别语义色：仅给图标上色，保持行内轻量（不染整行底色） */
.cw-tool--cat-read .cw-tool__cat-icon {
  color: var(--fg-accent);
}

.cw-tool--cat-write .cw-tool__cat-icon {
  color: var(--fg-success);
}

.cw-tool--cat-destructive .cw-tool__cat-icon {
  color: var(--fg-danger);
}

.cw-tool--cat-exec .cw-tool__cat-icon {
  color: var(--fg-warning);
}

.cw-tool--cat-network .cw-tool__cat-icon {
  color: var(--fg-accent);
}

/* 状态态：执行中给一抹柔和底色 + 边框转状态色 + 图标转状态色；失败同理走危险色 */
.cw-tool--running {
  border-color: var(--border-accent);
  background: color-mix(in srgb, transparent 86%, var(--bg-accent-soft) 14%);
}

.cw-tool--running .cw-tool__cat-icon {
  color: var(--fg-accent);
}

.cw-tool--error {
  border-color: var(--border-danger);
  background: color-mix(in srgb, transparent 88%, var(--bg-danger-soft) 12%);
}

.cw-tool--error .cw-tool__cat-icon {
  color: var(--fg-danger);
}

/* hover 仅提亮边框，不再叠加灰底（避免与状态态底色叠成两层） */
.cw-tool:hover {
  border-color: var(--border-accent);
}

/* 右侧展开箭头：仅有详情时出现，瞬时翻转（无过渡） */
.cw-tool__chevron {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.cw-tool__chevron.is-open {
  transform: rotate(180deg);
}

/* 统一详情区：参数 + 结果/错误，点击行展开后纵向堆叠 */
.cw-tool__detail-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  padding-left: 20px;
}

.cw-tool__detail-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.cw-tool__detail-label.is-error {
  color: var(--fg-danger);
}

.cw-tool__detail-body {
  margin: 0;
  padding: 6px 8px;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  border-radius: 0;
  border: 1px solid var(--border);
  color: var(--text);
  background: var(--surface-3);
}

.cw-tool__detail-body.is-error {
  color: var(--fg-danger);
}

@keyframes cw-px-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cw-tool,
  .cw-tool__spinner {
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
  border: var(--px-bw) solid var(--border-accent);
  border-radius: 0;
  background: var(--bg-accent-soft);
  box-shadow: var(--px-shadow);
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
  display: inline-flex;
  align-items: center;
  transition: none;
  user-select: none;
}

.cw-approval__toggle:hover {
  color: var(--text);
}

/* 与工具卡片的展开箭头同一视觉语言：13px chevron，展开时旋转 180°（瞬时） */
.cw-approval__chevron {
  width: 13px;
  height: 13px;
}

.cw-approval__chevron.is-open {
  transform: rotate(180deg);
}

/* 反白徽章：审批类型一眼可辨 */
.cw-approval__kind {
  font-size: 12px;
  font-weight: 600;
  padding: 1px 6px;
  color: var(--bg);
  background: var(--fg-accent);
  flex-shrink: 0;
}

.cw-approval--command .cw-approval__kind {
  background: var(--fg-danger);
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
  border-radius: 0;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.cw-approval__diff-viewer {
  max-height: 400px;
  overflow-y: auto;
  border-radius: 0;
  background: var(--ui-code-bg);
  border: 1px solid var(--ui-code-border);
}

.cw-approval__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* provider 表单的复选项（启用思考）：自绘像素方块 checkbox */
.cw-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.cw-check input {
  flex-shrink: 0;
  appearance: none;
  width: 16px;
  height: 16px;
  margin: 0;
  border: var(--px-bw) solid var(--border);
  border-radius: 0;
  background: var(--surface-2);
  cursor: pointer;
}

/* 选中 = 实心填充 + inset 留白圈出内方块 */
.cw-check input:checked {
  border-color: var(--border-accent);
  background: var(--fg-accent);
  box-shadow: inset 0 0 0 3px var(--surface-2);
}

.cw-check input:focus-visible {
  outline: 2px solid var(--border-accent);
  outline-offset: 2px;
}

/* 思考过程折叠区 */
.cw-think {
  border: var(--px-bw) dashed var(--border);
  border-radius: 0;
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
  list-style: none;
}

.cw-think summary::-webkit-details-marker {
  display: none;
}

/* 像素风折叠箭头，替代原生 marker / emoji */
.cw-think summary::before {
  content: "▸";
  color: var(--text-muted);
}

.cw-think[open] summary::before {
  content: "▾";
}

.cw-think__status {
  font-size: 12px;
  color: var(--fg-accent);
}

.cw-think__body {
  margin: 6px 0 2px;
  padding: 8px;
  max-height: 280px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 18px;
  color: var(--text-muted);
  background: var(--surface-3);
  border-radius: 0;
  border: 1px solid var(--border);
}
</style>
