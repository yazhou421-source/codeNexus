import {
  ArrowUp,
  ChevronDown,
  FileDiff,
  FilePlus,
  FileSearch,
  Folder,
  FolderOpen,
  Globe,
  Settings2,
  Square,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { estimateTokens } from "@codenexus/agent-core/contextWindow";
import type { CustomProviderKind, LocalCustomProvider } from "@codenexus/shared/localSettings";
import { codexDesktop } from "../../api/codexDesktopClient";
import { getCachedUserLocalSettings, loadUserLocalSettings, patchUserLocalSettings } from "../../domain/localSettings";
import {
  useCustomChatStore,
  type CustomApprovalRequest,
  type CustomChatMessage,
  type CustomChatPart,
  type CustomChatToolPart,
  type CustomToolActivity,
} from "../../stores/customChat.store";
import AgentMarkdownContent from "../ui/AgentMarkdownContent";
import ExecutionWaveText from "../ui/ExecutionWaveText";
import SelectDropdown from "../ui/SelectDropdown";
import UnifiedDiffViewer from "../timeline/cards/UnifiedDiffViewer";

type ProviderForm = {
  kind: CustomProviderKind;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens: string;
  contextLimit: string;
  thinking: boolean;
};

const emptyForm: ProviderForm = {
  kind: "openai-compatible",
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  maxOutputTokens: "",
  contextLimit: "",
  thinking: false,
};

const DEFAULT_CONTEXT_LIMIT = 200_000;
const CONTEXT_BLOCK_COUNT = 5;
const COMPOSER_MIN_HEIGHT = 48;
const COMPOSER_MAX_HEIGHT = 200;
const composerSizeStyle: CSSProperties = {
  height: `${COMPOSER_MIN_HEIGHT}px`,
  maxHeight: `${COMPOSER_MAX_HEIGHT}px`,
};

function formFromProvider(provider: LocalCustomProvider): ProviderForm {
  return {
    kind: provider.kind,
    name: provider.name,
    baseUrl: provider.baseUrl ?? "",
    apiKey: provider.apiKey ?? "",
    model: provider.model,
    maxOutputTokens: provider.maxOutputTokens ? String(provider.maxOutputTokens) : "",
    contextLimit: provider.contextLimit ? String(provider.contextLimit) : "",
    thinking: Boolean(provider.thinking),
  };
}

function providerFromForm(form: ProviderForm, id?: string): LocalCustomProvider {
  const positiveIntOrNull = (value: string) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  return {
    id: id || `cp-${Date.now()}`,
    kind: form.kind,
    name: form.name.trim() || "Custom Provider",
    baseUrl: form.baseUrl.trim() || null,
    apiKey: form.apiKey.trim() || null,
    model: form.model.trim(),
    thinking: form.thinking,
    maxOutputTokens: positiveIntOrNull(form.maxOutputTokens),
    contextLimit: positiveIntOrNull(form.contextLimit),
  };
}

function kindLabel(kind: CustomProviderKind) {
  if (kind === "anthropic") return "Claude";
  if (kind === "gemini") return "Gemini";
  return "OpenAI 兼容";
}

function providerOptionLabel(provider: LocalCustomProvider) {
  return `${provider.name} · ${kindLabel(provider.kind)} · ${provider.model || "未设置模型"}`;
}

function formatSessionTime(value: number) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function shortPath(path: string) {
  const normalized = String(path ?? "").trim();
  if (!normalized) return "";
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || normalized;
}

function toolCategory(name: string) {
  const raw = name.toLowerCase();
  if (/(write|edit|patch|save|create)/.test(raw)) return "write";
  if (/(rm|delete|remove)/.test(raw)) return "destructive";
  if (/(bash|shell|command|exec|powershell|terminal)/.test(raw)) return "exec";
  if (/(web|http|fetch|search)/.test(raw)) return "network";
  return "read";
}

function toolIcon(name: string): ComponentType<{ className?: string; "aria-hidden"?: boolean }> {
  const category = toolCategory(name);
  if (category === "write") return FilePlus;
  if (category === "destructive") return Trash2;
  if (category === "exec") return Terminal;
  if (category === "network") return Globe;
  if (/diff|patch/.test(name.toLowerCase())) return FileDiff;
  if (/search|find/.test(name.toLowerCase())) return FileSearch;
  return Wrench;
}

function toolStatusLabel(status: CustomToolActivity["status"]) {
  if (status === "running") return "执行中";
  if (status === "error") return "失败";
  return "完成";
}

function toolArgsSummary(argsText: string) {
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
    // Non-JSON args stream in as compact text.
  }
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function unescapeJsonFragment(text: string) {
  return text.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function toolArgsPreview(text: string) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      if (typeof obj.content === "string") return obj.content;
      return JSON.stringify(obj, null, 2);
    }
  } catch {
    // Streaming JSON fragments may be incomplete; show an unescaped preview.
  }
  return unescapeJsonFragment(raw);
}

function toolHasPreview(argsText: string) {
  const preview = toolArgsPreview(argsText);
  return preview.includes("\n") || preview.length > 80;
}

function formatCompactTokens(n: number) {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return String(n);
}

function isDiffContent(text: string) {
  return /^diff --git /m.test(text) || /^@@ /m.test(text) || /^(---|\+\+\+) /m.test(text);
}

function extractFilenameFromDetail(text: string) {
  const match = String(text).match(/^\+\+\+ b\/(.+)$/m) || String(text).match(/^--- a\/(.+)$/m);
  return match?.[1] ?? "changes.diff";
}

function renderTextPart(part: CustomChatPart) {
  if (part.type !== "text") return null;
  return (
    <AgentMarkdownContent
      key={part.id}
      className="cw-msg__body cw-msg__body--md agent-markdown-body"
      markdown={part.text}
    />
  );
}

function ToolPartView({
  part,
  open,
  onToggle,
}: {
  part: CustomChatToolPart;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = toolIcon(part.tool.name);
  const hasArgsPreview = toolHasPreview(part.tool.argsText);
  const hasDetail = hasArgsPreview || Boolean(part.tool.resultText || part.tool.error);
  const category = toolCategory(part.tool.name);
  const summary = toolArgsSummary(part.tool.argsText);
  const rowContent = (
    <>
      <Icon className="cw-tool__cat-icon" aria-hidden={true} />
      <span className="cw-tool__name mono">{part.tool.name}</span>
      {summary ? <span className="cw-tool__sep">·</span> : null}
      <span className="cw-tool__args mono">{summary}</span>
      <span className={`cw-tool__state cw-tool__state--${part.tool.status}`} title={toolStatusLabel(part.tool.status)}>
        {part.tool.status === "running" ? (
          <span className="cw-tool__spinner" role="img" aria-label={toolStatusLabel(part.tool.status)} />
        ) : part.tool.status === "done" ? (
          <span className="cw-tool__check" role="img" aria-label="完成" />
        ) : (
          <X className="cw-tool__err-icon" role="img" aria-label="失败" />
        )}
      </span>
      {hasDetail ? <ChevronDown className={`cw-tool__chevron${open ? " is-open" : ""}`} aria-hidden="true" /> : null}
    </>
  );

  return (
    <div className={`cw-tool cw-tool--${part.tool.status} cw-tool--cat-${category}${open ? " is-open" : ""}`}>
      {hasDetail ? (
        <button className="cw-tool__row is-clickable" type="button" aria-expanded={open ? "true" : "false"} onClick={onToggle}>
          {rowContent}
        </button>
      ) : (
        <div className="cw-tool__row">{rowContent}</div>
      )}
      {hasDetail && open ? (
        <div className="cw-tool__detail-panel">
          {hasArgsPreview ? (
            <>
              <div className="cw-tool__detail-label">参数</div>
              <pre className="cw-tool__detail-body mono">{toolArgsPreview(part.tool.argsText)}</pre>
            </>
          ) : null}
          {part.tool.resultText || part.tool.error ? (
            <>
              <div className={`cw-tool__detail-label${part.tool.error ? " is-error" : ""}`}>
                {part.tool.error ? "错误" : "结果"}
              </div>
              <pre className={`cw-tool__detail-body mono${part.tool.error ? " is-error" : ""}`}>
                {part.tool.error || part.tool.resultText}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function CustomWorkbench() {
  const customChatStore = useCustomChatStore();
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [providers, setProviders] = useState<LocalCustomProvider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testOk, setTestOk] = useState(false);
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
  const [collapsedApprovals, setCollapsedApprovals] = useState<Record<string, boolean>>({});

  const activeProvider = providers.find((provider) => provider.id === activeProviderId) ?? null;
  const hasActiveProvider = Boolean(activeProvider?.baseUrl && activeProvider.apiKey && activeProvider.model);
  const canSaveProvider = Boolean(form.baseUrl.trim() && form.apiKey.trim() && form.model.trim());
  const canSend = Boolean(draft.trim() && hasActiveProvider && !customChatStore.sending);
  const baseUrlPlaceholder = form.kind === "anthropic" ? "https://api.anthropic.com" : form.kind === "gemini" ? "https://generativelanguage.googleapis.com" : "https://api.openai.com/v1";
  const modelPlaceholder = form.kind === "anthropic" ? "claude-..." : form.kind === "gemini" ? "gemini-..." : "gpt-4o-mini";
  const contextUsedTokens = Number(customChatStore.estimatedContextTokens ?? 0) + (draft.trim() ? estimateTokens(draft.trim()) + 4 : 0);
  const contextLimitTokens = activeProvider?.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
  const contextUsagePercent = contextLimitTokens > 0 ? Math.min(100, Math.round((contextUsedTokens / contextLimitTokens) * 100)) : 0;
  const contextBlocksOn = contextUsagePercent === 0 ? 0 : Math.max(1, Math.ceil((contextUsagePercent / 100) * CONTEXT_BLOCK_COUNT));
  const contextUsageState = contextLimitTokens > 0 && contextUsedTokens / contextLimitTokens >= 1 ? "over" : contextLimitTokens > 0 && contextUsedTokens / contextLimitTokens >= 0.8 ? "warn" : "normal";
  const contextCompactLabel = formatCompactTokens(contextUsedTokens);
  const contextUsageTitle =
    contextUsageState === "over"
      ? "按字符估算（CJK≈1.5、其余≈4 字符/token），含正在输入的草稿；为近似值。\n已超上限：发送时内核会丢弃最旧历史，仅保留最近窗口（system 与工具调用配对不拆开）。"
      : "按字符估算（CJK≈1.5、其余≈4 字符/token），含正在输入的草稿；为近似值。\n超过上限时，内核会自动裁掉最旧历史。";

  const providerSelectOptions = useMemo(
    () =>
      providers.map((provider) => ({
        value: provider.id,
        label: providerOptionLabel(provider),
      })),
    [providers],
  );

  const snapshot = useMemo(
    () => ({
      providerId: activeProviderId,
      providerLabel: activeProvider ? providerOptionLabel(activeProvider) : null,
      workspaceRoot,
    }),
    [activeProvider, activeProviderId, workspaceRoot],
  );

  const patchCustomProviders = async (patch: {
    providers?: LocalCustomProvider[];
    activeProviderId?: string | null;
    workspaceRoot?: string | null;
  }) => {
    const current = getCachedUserLocalSettings().settings.customProviders;
    const next = {
      providers: patch.providers ?? current.providers,
      activeProviderId: patch.activeProviderId === undefined ? current.activeProviderId : patch.activeProviderId,
      workspaceRoot: patch.workspaceRoot === undefined ? current.workspaceRoot : patch.workspaceRoot,
    };
    const loaded = await patchUserLocalSettings({ customProviders: next });
    const saved = loaded.settings.customProviders;
    setProviders(saved.providers);
    setActiveProviderId(saved.activeProviderId);
    setWorkspaceRoot(saved.workspaceRoot);
    const selectedProvider = saved.providers.find((provider) => provider.id === saved.activeProviderId) ?? null;
    await useCustomChatStore.getState().persistCurrentSession({
      providerId: saved.activeProviderId,
      providerLabel: selectedProvider ? providerOptionLabel(selectedProvider) : null,
      workspaceRoot: saved.workspaceRoot,
    });
    return saved;
  };

  useEffect(() => {
    let alive = true;
    void loadUserLocalSettings(true)
      .then((loaded) => {
        if (!alive) return;
        const customProviders = loaded.settings.customProviders;
        setProviders(customProviders.providers);
        setActiveProviderId(customProviders.activeProviderId);
        setWorkspaceRoot(customProviders.workspaceRoot);
        const selectedProvider = customProviders.providers.find((provider) => provider.id === customProviders.activeProviderId) ?? null;
        const selectedIsUsable = Boolean(selectedProvider?.baseUrl && selectedProvider.apiKey && selectedProvider.model);
        setShowConfig(!selectedIsUsable);
        if (customProviders.providers.length === 0) {
          setEditing(true);
          setEditingId(null);
          setForm(emptyForm);
          setTestMessage("");
          setTestOk(false);
        }
        void useCustomChatStore.getState().initSessions({
          providerId: customProviders.activeProviderId,
          providerLabel: selectedProvider ? providerOptionLabel(selectedProvider) : null,
          workspaceRoot: customProviders.workspaceRoot,
        });
      })
      .catch((error) => {
        setTestOk(false);
        setTestMessage(String((error as Error)?.message ?? error));
      });
    useCustomChatStore.getState().ensureStreamSubscription();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // 仅当用户已贴近底部时才自动跟随；向上翻历史时不打扰
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom > 56) return;
    el.scrollTop = el.scrollHeight;
  }, [customChatStore.messages, customChatStore.sending]);

  const autoGrowComposer = (el = inputRef.current) => {
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, el.scrollHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  };

  const resetComposerHeight = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = `${COMPOSER_MIN_HEIGHT}px`;
    el.style.overflowY = "hidden";
  };

  const createSession = async () => {
    resetComposerHeight();
    await customChatStore.newSession(snapshot);
    setDraft("");
  };

  const scrollMessagesToBottom = (behavior: ScrollBehavior = "auto") => {
    const el = listRef.current;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : behavior });
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || !hasActiveProvider) return;
    setDraft("");
    resetComposerHeight();
    requestAnimationFrame(() => scrollMessagesToBottom("smooth"));
    await customChatStore.send(text, snapshot);
  };

  const saveProvider = async () => {
    if (!canSaveProvider) return;
    const provider = providerFromForm(form, editingId ?? undefined);
    const nextProviders = editingId
      ? providers.map((item) => (item.id === editingId ? provider : item))
      : [...providers, provider];
    await patchCustomProviders({ providers: nextProviders, activeProviderId: provider.id });
    setEditing(false);
    setEditingId(null);
    setForm(emptyForm);
    setShowConfig(false);
  };

  const removeProvider = async (id: string) => {
    const nextProviders = providers.filter((provider) => provider.id !== id);
    const nextActiveId = activeProviderId === id ? (nextProviders[0]?.id ?? null) : activeProviderId;
    await patchCustomProviders({ providers: nextProviders, activeProviderId: nextActiveId });
    if (editingId === id) setEditing(false);
  };

  const pickWorkspace = async () => {
    const selected = await codexDesktop.workspace.select();
    if (!selected) return;
    await patchCustomProviders({ workspaceRoot: selected });
  };

  const testConnection = async () => {
    if (!canSaveProvider || testing) return;
    setTesting(true);
    setTestMessage("");
    try {
      const result = await codexDesktop.app.testCodexProvider({
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
      });
      setTestOk(result.ok);
      setTestMessage(
        result.ok
          ? `连接成功${typeof result.modelCount === "number" ? `，发现 ${result.modelCount} 个模型` : ""}。`
          : `连接失败：${result.message}`,
      );
    } catch (error: unknown) {
      setTestOk(false);
      setTestMessage(`连接失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTesting(false);
    }
  };

  const renderMessage = (message: CustomChatMessage) => {
    const roleLabel = message.role === "user" ? "你" : message.error ? "错误" : "助手";
    const hasParts = message.role === "assistant" && !message.error && message.parts && message.parts.length > 0;
    return (
      <div key={message.id} className={`cw-msg cw-msg--${message.role}${message.error ? " is-error" : ""}`}>
        <div className="cw-msg__role">{roleLabel}</div>
        {message.role === "assistant" && message.reasoning ? (
          <details className="cw-think">
            <summary>
              思考过程
              {message.streaming ? <ExecutionWaveText text="(生成中)" enabled className="cw-think__status" /> : null}
            </summary>
            <pre className="cw-think__body mono">{message.reasoning}</pre>
          </details>
        ) : null}
        {hasParts ? (
          <div className="cw-msg__parts">
            {message.parts!.map((part) => {
              if (part.type === "text") return renderTextPart(part);
              const key = part.tool.callId || `${message.id}:${part.id}`;
              return (
                <ToolPartView
                  key={part.id}
                  part={part}
                  open={openTools[key] ?? part.tool.status === "running"}
                  onToggle={() => setOpenTools((current) => ({ ...current, [key]: !(current[key] ?? part.tool.status === "running") }))}
                />
              );
            })}
          </div>
        ) : (
          <div className={`cw-msg__body${message.streaming && !message.content ? " cw-msg__body--pending" : ""}`}>
            {message.streaming && !message.content ? <ExecutionWaveText text="思考中" enabled /> : message.content}
          </div>
        )}
      </div>
    );
  };

  const renderApproval = (approval: CustomApprovalRequest) => {
    const collapsed = Boolean(collapsedApprovals[approval.approvalId]);
    return (
      <div key={approval.approvalId} className={`cw-approval cw-approval--${approval.kind}`}>
        <div className="cw-approval__head">
          <span className="cw-approval__kind">{approval.kind === "command" ? "命令审批" : "文件写改审批"}</span>
          <span className="cw-approval__title mono">{approval.title}</span>
          <button
            type="button"
            className="cw-approval__toggle"
            aria-expanded={collapsed ? "false" : "true"}
            onClick={() => setCollapsedApprovals((current) => ({ ...current, [approval.approvalId]: !current[approval.approvalId] }))}
          >
            <ChevronDown className={`cw-approval__chevron${collapsed ? "" : " is-open"}`} aria-hidden="true" />
          </button>
        </div>
        {!collapsed ? (
          isDiffContent(approval.detail) ? (
            <UnifiedDiffViewer
              diffText={approval.detail}
              ariaLabel={extractFilenameFromDetail(approval.detail)}
              className="cw-approval__diff-viewer"
            />
          ) : (
            <pre className="cw-approval__detail mono">{approval.detail}</pre>
          )
        ) : null}
        <div className="cw-approval__actions">
          <button className="cw-btn cw-btn--ghost-danger" type="button" onClick={() => void customChatStore.respondApproval(approval.approvalId, false)}>
            拒绝
          </button>
          <button className="cw-btn cw-btn--primary" type="button" onClick={() => void customChatStore.respondApproval(approval.approvalId, true)}>
            同意
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="custom-workbench">
      <aside className="cw-sessions">
        <div className="cw-sessions__head">
          <strong>Custom 会话</strong>
          <button className="cw-btn cw-btn--compact cw-btn--primary" type="button" disabled={customChatStore.sending} onClick={() => void createSession()}>
            + 新建
          </button>
        </div>
        {customChatStore.loadingSessions ? (
          <div className="cw-sessions__empty">加载中...</div>
        ) : customChatStore.sessions.length === 0 ? (
          <div className="cw-sessions__empty">暂无历史会话</div>
        ) : (
          <div className="cw-session-list app-scrollbar">
            {customChatStore.sessions.map((session) => (
              <div key={session.id} className={`cw-session${session.id === customChatStore.currentSessionId ? " is-active" : ""}`}>
                <button
                  className="cw-session__main"
                  type="button"
                  disabled={customChatStore.sending}
                  onClick={() => {
                    if (customChatStore.sending) return;
                    setDraft("");
                    resetComposerHeight();
                    void customChatStore.loadSession(session.id);
                  }}
                >
                  <span className="cw-session__title">{session.title || "新会话"}</span>
                  <span className="cw-session__meta">{formatSessionTime(session.updatedAt)}</span>
                  {session.providerLabel ? <span className="cw-session__provider">{session.providerLabel}</span> : null}
                </button>
                <button
                  className="cw-session__delete"
                  type="button"
                  disabled={customChatStore.sending && session.id === customChatStore.currentSessionId}
                  title="删除会话"
                  onClick={() => void customChatStore.deleteSession(session.id, snapshot)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>

      <section className="cw-main">
        <header className="cw-header">
          <div className="cw-header__actions">
            <button
              type="button"
              className={`cw-btn${showConfig ? " is-on" : ""}`}
              aria-pressed={showConfig ? "true" : "false"}
              onClick={() => setShowConfig((value) => !value)}
            >
              <Settings2 className="cw-btn__icon" aria-hidden="true" />
              配置 Provider
            </button>
          </div>
        </header>

        {showConfig ? (
          <section className="cw-config app-scrollbar">
            <div className="cw-config__list">
              <h2>Providers</h2>
              {providers.length === 0 ? <p className="cw-config__hint">还没有配置任何 provider，点下方“新增”开始。</p> : null}
              {providers.map((provider) => (
                <div key={provider.id} className={`cw-provider${provider.id === activeProviderId ? " is-active" : ""}`}>
                  <div className="cw-provider__info">
                    <span className="cw-provider__name">{provider.name}</span>
                    <span className="cw-provider__kind">{kindLabel(provider.kind)}</span>
                    <span className="cw-provider__model">{provider.model || "未设置模型"}</span>
                  </div>
                  <div className="cw-provider__actions">
                    {provider.id !== activeProviderId ? (
                      <button className="cw-btn cw-btn--accent" type="button" onClick={() => void patchCustomProviders({ activeProviderId: provider.id })}>
                        激活
                      </button>
                    ) : (
                      <span className="cw-provider__current">当前</span>
                    )}
                    <button
                      className="cw-btn"
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setEditingId(provider.id);
                        setForm(formFromProvider(provider));
                      }}
                    >
                      编辑
                    </button>
                    <button className="cw-btn cw-btn--danger cw-provider__remove" type="button" onClick={() => void removeProvider(provider.id)}>
                      删除
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="cw-btn cw-btn--primary cw-config__add"
                onClick={() => {
                  setEditing(true);
                  setEditingId(null);
                  setForm(emptyForm);
                  setTestMessage("");
                }}
              >
                + 新增 Provider
              </button>
            </div>

            {editing ? (
              <form
                className="cw-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveProvider();
                }}
              >
                <h2>{editingId ? "编辑 Provider" : "新增 Provider"}</h2>
                <label className="cw-field">
                  <span>协议</span>
                  <select value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value as CustomProviderKind }))}>
                    <option value="openai-compatible">OpenAI 兼容</option>
                    <option value="anthropic">Claude（Anthropic）</option>
                    <option value="gemini">Gemini</option>
                  </select>
                </label>
                <label className="cw-field">
                  <span>名称</span>
                  <input value={form.name} type="text" placeholder="My Provider" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label className="cw-field">
                  <span>Base URL</span>
                  <input value={form.baseUrl} type="text" placeholder={baseUrlPlaceholder} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} />
                </label>
                <label className="cw-field">
                  <span>API Key</span>
                  <input value={form.apiKey} type="text" placeholder="sk-..." autoComplete="off" onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} />
                </label>
                <label className="cw-field">
                  <span>模型</span>
                  <input value={form.model} type="text" placeholder={modelPlaceholder} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} />
                </label>
                <label className="cw-field">
                  <span>最大输出 tokens</span>
                  <input value={form.maxOutputTokens} type="number" min="1" step="1" placeholder="留空用服务端默认" onChange={(event) => setForm((current) => ({ ...current, maxOutputTokens: event.target.value }))} />
                </label>
                <label className="cw-field">
                  <span>上下文长度（输入 tokens）</span>
                  <input value={form.contextLimit} type="number" min="1" step="1" placeholder="留空不裁剪历史" onChange={(event) => setForm((current) => ({ ...current, contextLimit: event.target.value }))} />
                </label>
                <label className="cw-check">
                  <input checked={form.thinking} type="checkbox" onChange={(event) => setForm((current) => ({ ...current, thinking: event.target.checked }))} />
                  <span>启用思考 / 推理输出（支持的模型：Claude thinking · Gemini · DeepSeek-R1 等；不支持的模型请勿开启）</span>
                </label>
                <div className="cw-config__actions">
                  {form.kind === "openai-compatible" ? (
                    <button type="button" className="cw-btn" disabled={testing || !canSaveProvider} onClick={() => void testConnection()}>
                      {testing ? "测试中…" : "测试连接"}
                    </button>
                  ) : null}
                  <div className="cw-config__actions-commit">
                    <button
                      type="button"
                      className="cw-btn"
                      onClick={() => {
                        setEditing(false);
                      }}
                    >
                      取消
                    </button>
                    <button type="submit" className="cw-btn cw-btn--primary" disabled={!canSaveProvider}>
                      保存并激活
                    </button>
                  </div>
                </div>
                {form.kind !== "openai-compatible" ? <p className="cw-config__hint">连接测试目前仅支持 OpenAI 兼容协议；Claude / Gemini 直接保存后在对话中验证。</p> : null}
                {testMessage ? <p className={`cw-config__test${testOk ? "" : " is-error"}`}>{testMessage}</p> : null}
              </form>
            ) : null}
          </section>
        ) : (
          <div className="cw-chat-container">
            <div ref={listRef} className="cw-messages app-scrollbar">
              {customChatStore.messages.length === 0 ? (
                <div className="cw-empty">
                  <p>这是一个直连自定义 provider 的极简对话。发送一条消息开始。</p>
                </div>
              ) : (
                customChatStore.messages.map(renderMessage)
              )}
            </div>

            <footer className="cw-composer">
              {customChatStore.pendingApprovals.length > 0 ? (
                <div className="cw-approvals">{customChatStore.pendingApprovals.map(renderApproval)}</div>
              ) : null}
              {!hasActiveProvider ? (
                <p className="cw-composer__warn">
                  尚未配置可用 Provider，
                  <button type="button" className="cw-link" onClick={() => setShowConfig(true)}>
                    点此配置
                  </button>
                  。
                </p>
              ) : (
                <div className={`cw-shell${customChatStore.sending ? " is-sending" : ""}`}>
                  <textarea
                    ref={inputRef}
                    className="cw-shell__input app-scrollbar"
                    value={draft}
                    style={composerSizeStyle}
                    placeholder="给自定义模型发消息…（Enter 发送，Shift+Enter 换行）"
                    disabled={customChatStore.sending}
                    onChange={(event) => {
                      const el = event.target as HTMLTextAreaElement;
                      setDraft(el.value);
                      autoGrowComposer(el);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                      event.preventDefault();
                      void submit();
                    }}
                  />
                  <div className="cw-shell__bar">
                    <div className="cw-shell__left">
                      <SelectDropdown
                        className="cw-model-select"
                        modelValue={activeProviderId ?? ""}
                        options={providerSelectOptions}
                        disabled={customChatStore.sending}
                        ariaLabel="选择 Provider"
                        minPopoverWidth={260}
                        onValueChange={(value) => void patchCustomProviders({ activeProviderId: value })}
                      />
                      <button
                        className={`cw-tool-chip${workspaceRoot ? " is-set" : ""}`}
                        type="button"
                        title={workspaceRoot || "未选择工作区（使用系统工具，根目录为进程 cwd）"}
                        onClick={() => void pickWorkspace()}
                      >
                        {workspaceRoot ? <FolderOpen className="cw-tool-chip__icon" aria-hidden="true" /> : <Folder className="cw-tool-chip__icon" aria-hidden="true" />}
                        <span className="cw-tool-chip__label">{shortPath(workspaceRoot ?? "") || "工作区"}</span>
                        {workspaceRoot ? (
                          <span
                            className="cw-tool-chip__clear"
                            role="button"
                            aria-label="清除工作区"
                            onClick={(event) => {
                              event.stopPropagation();
                              void patchCustomProviders({ workspaceRoot: null });
                            }}
                          >
                            <X className="cw-tool-chip__clear-icon" aria-hidden="true" />
                          </span>
                        ) : null}
                      </button>
                    </div>
                    <div className="cw-shell__right">
                      <span className={`cw-context-chip cw-context-chip--${contextUsageState}`} title={contextUsageTitle}>
                        <span className="cw-context-blocks" aria-hidden="true">
                          {Array.from({ length: CONTEXT_BLOCK_COUNT }, (_, index) => (
                            <span key={index} className={`cw-context-blocks__cell${index < contextBlocksOn ? " is-on" : ""}`} />
                          ))}
                        </span>
                        <span className="cw-context-chip__label">{contextCompactLabel}</span>
                      </span>
                      {customChatStore.sending ? (
                        <button className="cw-send-btn cw-send-btn--stop" type="button" aria-label="停止生成" onClick={() => void customChatStore.cancelCurrentRun()}>
                          <Square className="cw-send-btn__icon" aria-hidden="true" />
                        </button>
                      ) : (
                        <button className="cw-send-btn" type="button" aria-label="发送" disabled={!canSend} onClick={() => void submit()}>
                          <ArrowUp className="cw-send-btn__icon" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
