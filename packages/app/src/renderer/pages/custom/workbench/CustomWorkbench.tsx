import { useEffect, useMemo, useRef, useState } from "react";
import { estimateTokens } from "@codenexus/agent-core/contextWindow";
import type { LocalCustomProvider } from "@codenexus/shared/localSettings";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { getCachedUserLocalSettings, loadUserLocalSettings, patchUserLocalSettings } from "../../../domain/localSettings";
import { useCustomChatStore } from "../../../stores/customChat.store";
import CustomComposer from "./CustomComposer";
import CustomMessage from "./CustomMessage";
import CustomProviderConfig, { CustomConfigToggle } from "./CustomProviderConfig";
import CustomSessionList from "./CustomSessionList";
import {
  CONTEXT_BLOCK_COUNT,
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  DEFAULT_CONTEXT_LIMIT,
  emptyForm,
  formatCompactTokens,
  formFromProvider,
  providerFromForm,
  providerOptionLabel,
  type ProviderForm,
} from "./helpers";

// 自定义运行时工作台：会话边栏 + 主区（Provider 配置 / 对话）。
// 本组件是有状态容器，渲染细节下放到 workbench/ 下的展示型子组件。
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
  // 上下文条优先用 provider 返回的真实输入侧用量；首轮回包前回退字符估算。叠加正在输入的草稿估算。
  const ctx = customChatStore.contextTokens;
  const draftTokens = draft.trim() ? estimateTokens(draft.trim()) + 4 : 0;
  const contextUsedTokens = Number(ctx.value ?? 0) + draftTokens;
  const contextIsActual = ctx.source === "actual";
  const sessionOutputTokens = Number(customChatStore.sessionOutputTokens ?? 0);
  const contextLimitTokens = activeProvider?.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
  const contextUsagePercent = contextLimitTokens > 0 ? Math.min(100, Math.round((contextUsedTokens / contextLimitTokens) * 100)) : 0;
  const contextBlocksOn = contextUsagePercent === 0 ? 0 : Math.max(1, Math.ceil((contextUsagePercent / 100) * CONTEXT_BLOCK_COUNT));
  const contextUsageState = contextLimitTokens > 0 && contextUsedTokens / contextLimitTokens >= 1 ? "over" : contextLimitTokens > 0 && contextUsedTokens / contextLimitTokens >= 0.8 ? "warn" : "normal";
  const contextCompactLabel = formatCompactTokens(contextUsedTokens);
  const sourceLine = contextIsActual
    ? `输入侧：上一轮 provider 返回的真实用量${draftTokens ? " + 草稿估算" : ""}。`
    : "输入侧：按字符估算（CJK≈1.5、其余≈4 字符/token），含草稿；为近似值。首轮回包后改用真实用量。";
  const outputLine = sessionOutputTokens > 0 ? `\n本会话累计输出：${formatCompactTokens(sessionOutputTokens)} tokens。` : "";
  const contextUsageTitle =
    contextUsageState === "over"
      ? `${sourceLine}${outputLine}\n已超上限：发送时内核会丢弃最旧历史，仅保留最近窗口（system 与工具调用配对不拆开）。`
      : `${sourceLine}${outputLine}\n超过上限时，内核会自动裁掉最旧历史。`;

  const providerSelectOptions = useMemo(
    () => providers.map((provider) => ({ value: provider.id, label: providerOptionLabel(provider) })),
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

  return (
    <div className="custom-workbench">
      <CustomSessionList
        snapshot={snapshot}
        onBeforeSwitch={() => {
          setDraft("");
          resetComposerHeight();
        }}
      />

      <section className="cw-main">
        <header className="cw-header">
          <div className="cw-header__actions">
            <CustomConfigToggle active={showConfig} onToggle={() => setShowConfig((value) => !value)} />
          </div>
        </header>

        {showConfig ? (
          <CustomProviderConfig
            providers={providers}
            activeProviderId={activeProviderId}
            editing={editing}
            editingId={editingId}
            form={form}
            testing={testing}
            testOk={testOk}
            testMessage={testMessage}
            canSaveProvider={canSaveProvider}
            baseUrlPlaceholder={baseUrlPlaceholder}
            modelPlaceholder={modelPlaceholder}
            onActivate={(id) => void patchCustomProviders({ activeProviderId: id })}
            onStartEdit={(provider) => {
              setEditing(true);
              setEditingId(provider.id);
              setForm(formFromProvider(provider));
            }}
            onRemove={(id) => void removeProvider(id)}
            onStartCreate={() => {
              setEditing(true);
              setEditingId(null);
              setForm(emptyForm);
              setTestMessage("");
            }}
            onCancelEdit={() => setEditing(false)}
            onChangeForm={(patch) => setForm((current) => ({ ...current, ...patch }))}
            onSave={() => void saveProvider()}
            onTestConnection={() => void testConnection()}
          />
        ) : (
          <div className="cw-chat-container">
            <div ref={listRef} className="cw-messages app-scrollbar">
              {customChatStore.messages.length === 0 ? (
                <div className="cw-empty">
                  <p>这是一个直连自定义 provider 的极简对话。发送一条消息开始。</p>
                </div>
              ) : (
                customChatStore.messages.map((message) => (
                  <CustomMessage
                    key={message.id}
                    message={message}
                    openTools={openTools}
                    onToggleTool={(key, defaultOpen) =>
                      setOpenTools((current) => ({ ...current, [key]: !(current[key] ?? defaultOpen) }))
                    }
                  />
                ))
              )}
            </div>

            <CustomComposer
              draft={draft}
              inputRef={inputRef}
              hasActiveProvider={hasActiveProvider}
              canSend={canSend}
              activeProviderId={activeProviderId}
              providerSelectOptions={providerSelectOptions}
              workspaceRoot={workspaceRoot}
              contextUsageState={contextUsageState}
              contextUsageTitle={contextUsageTitle}
              contextBlockCount={CONTEXT_BLOCK_COUNT}
              contextBlocksOn={contextBlocksOn}
              contextCompactLabel={contextCompactLabel}
              contextIsActual={contextIsActual}
              sessionOutputLabel={sessionOutputTokens > 0 ? formatCompactTokens(sessionOutputTokens) : null}
              collapsedApprovals={collapsedApprovals}
              onToggleApprovalCollapsed={(approvalId) =>
                setCollapsedApprovals((current) => ({ ...current, [approvalId]: !current[approvalId] }))
              }
              onOpenConfig={() => setShowConfig(true)}
              onDraftChange={(value, el) => {
                setDraft(value);
                autoGrowComposer(el);
              }}
              onSubmit={() => void submit()}
              onSelectProvider={(value) => void patchCustomProviders({ activeProviderId: value })}
              onPickWorkspace={() => void pickWorkspace()}
              onClearWorkspace={() => void patchCustomProviders({ workspaceRoot: null })}
            />
          </div>
        )}
      </section>
    </div>
  );
}
