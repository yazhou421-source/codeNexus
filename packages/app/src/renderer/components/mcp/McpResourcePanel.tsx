import { useEffect, useMemo, useRef } from "react";
import SelectDropdown from "../ui/SelectDropdown";
import type {
  McpResourceEntry as Resource,
  McpResourceParameterEntry,
  McpResourceTemplateEntry as ResourceTemplate,
} from "../../domain/types";
import { getRuntimeOrchestrator } from "../../domain/runtimeOrchestrator";
import { useMcpStore } from "../../stores/mcp.store";
import { useMcpResourceStore } from "../../stores/mcpResource.store";
import { useRuntimeStore } from "../../stores/runtime.store";

type McpResourcePanelProps = {
  className?: string;
};

type TemplateAnalysis = {
  variables: string[];
  supported: boolean;
};

const SIMPLE_TEMPLATE_EXPR_RE = /\{([^{}]+)\}/g;
const TEMPLATE_AUTOREAD_DEBOUNCE_MS = 350;

function resourceCardClass(active: boolean) {
  return active
    ? "border-[var(--border-accent)] bg-[var(--bg-accent-soft)]"
    : "border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] hover:border-[var(--ui-well-border-hover)] hover:bg-[var(--ui-well-bg-strong)]";
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function toReadTargetKey(threadIdValue: unknown, serverIdValue: unknown, uriValue: unknown): string {
  const threadId = normalizeText(threadIdValue);
  const serverId = normalizeText(serverIdValue);
  const uri = normalizeText(uriValue);
  return threadId && serverId && uri ? `${threadId}::${serverId}::${uri}` : "";
}

function resourceDisplayTitle(resource: Resource): string {
  return (
    normalizeText(resource.title) ||
    normalizeText(resource.name) ||
    normalizeText(resource.uri) ||
    "未命名资源"
  );
}

function templateDisplayTitle(template: ResourceTemplate): string {
  return (
    normalizeText(template.title) ||
    normalizeText(template.name) ||
    normalizeText(template.uriTemplate) ||
    "未命名模板"
  );
}

function buildTemplateParameterEntries(
  variableNames: string[],
  values: Record<string, string>,
  manualUriValue: string,
  resolvedUriValue: string
): McpResourceParameterEntry[] {
  const entries: McpResourceParameterEntry[] = variableNames.map((name) => ({
    key: name,
    value: normalizeText(values[name]),
  }));
  const manualUri = normalizeText(manualUriValue);
  const resolvedUri = normalizeText(resolvedUriValue);
  if (manualUri) entries.push({ key: "manualUri", value: manualUri });
  if (resolvedUri && resolvedUri !== manualUri) entries.push({ key: "resolvedUri", value: resolvedUri });
  return entries;
}

function analyzeTemplate(templateValue: unknown): TemplateAnalysis {
  const template = String(templateValue ?? "");
  const variables: string[] = [];
  let supported = true;
  let match: RegExpExecArray | null = null;
  SIMPLE_TEMPLATE_EXPR_RE.lastIndex = 0;
  while ((match = SIMPLE_TEMPLATE_EXPR_RE.exec(template)) !== null) {
    const expression = String(match[1] ?? "").trim();
    if (!expression) {
      supported = false;
      continue;
    }
    const hasComplexSyntax =
      /^[+#./;?&]/.test(expression) || expression.includes(",") || expression.includes("*") || expression.includes(":");
    if (hasComplexSyntax) supported = false;
    const candidateParts = expression
      .replace(/^[+#./;?&]/, "")
      .split(",")
      .map((item) => item.replace(/[:*].*$/, "").trim())
      .filter(Boolean);
    for (const part of candidateParts) {
      if (!/^[A-Za-z0-9_.-]+$/.test(part)) {
        supported = false;
        continue;
      }
      if (!variables.includes(part)) variables.push(part);
    }
  }
  return { variables, supported };
}

function buildTemplatePreviewUri(templateValue: unknown, values: Record<string, string>): string {
  const template = String(templateValue ?? "");
  const analysis = analyzeTemplate(template);
  if (!analysis.supported) return template;
  SIMPLE_TEMPLATE_EXPR_RE.lastIndex = 0;
  return template.replace(SIMPLE_TEMPLATE_EXPR_RE, (_, expr: string) => {
    const key = String(expr ?? "").trim();
    const value = normalizeText(values[key]);
    return value ? encodeURIComponent(value) : `{${key}}`;
  });
}

export default function McpResourcePanel({ className }: McpResourcePanelProps) {
  const runtime = getRuntimeOrchestrator();
  const runtimeStore = useRuntimeStore();
  const mcpStore = useMcpStore();
  const mcpResourceStore = useMcpResourceStore();
  const templateAutoReadTimerRef = useRef<number | null>(null);
  const latestReadSeqRef = useRef(0);
  const inflightReadTargetKeyRef = useRef("");
  const currentSelectionReadKeyRef = useRef("");

  const serverOptions = useMemo(
    () => mcpStore.servers.map((server) => ({ value: server.id, label: server.id })),
    [mcpStore.servers]
  );
  const selectedServer =
    mcpStore.servers.find((server) => server.id === mcpResourceStore.selectedServerId) ?? null;
  const activeTab = mcpResourceStore.activeTab;
  const selectedResource =
    selectedServer && mcpResourceStore.selectedResourceUri
      ? selectedServer.resources.find((resource) => resource.uri === mcpResourceStore.selectedResourceUri) ?? null
      : null;
  const selectedTemplate =
    selectedServer && mcpResourceStore.selectedTemplateKey
      ? selectedServer.resourceTemplates.find((template) => template.uriTemplate === mcpResourceStore.selectedTemplateKey) ?? null
      : null;
  const selectedTemplateAnalysis = useMemo(
    () => analyzeTemplate(selectedTemplate?.uriTemplate ?? ""),
    [selectedTemplate?.uriTemplate]
  );
  const selectedTemplateDraft = mcpResourceStore.getTemplateDraft(mcpResourceStore.selectedTemplateKey);
  const templatePreviewUri = selectedTemplate
    ? buildTemplatePreviewUri(selectedTemplate.uriTemplate, selectedTemplateDraft.values)
    : "";
  const resolvedTemplateUri = normalizeText(selectedTemplateDraft.manualUri) || normalizeText(templatePreviewUri);
  const activeSelectionUri = activeTab === "resources" ? mcpResourceStore.selectedResourceUri : resolvedTemplateUri;
  const currentThreadId = normalizeText(runtimeStore.currentThreadId);
  const currentSelectionReadKey = toReadTargetKey(currentThreadId, selectedServer?.id ?? "", activeSelectionUri);
  currentSelectionReadKeyRef.current = currentSelectionReadKey;

  const hasMatchingResult = Boolean(
    mcpResourceStore.currentResult &&
      selectedServer &&
      currentThreadId &&
      mcpResourceStore.currentResult.threadId === currentThreadId &&
      mcpResourceStore.currentResult.serverId === selectedServer.id &&
      mcpResourceStore.currentResult.uri === activeSelectionUri
  );
  const fallbackResourceLabel =
    activeTab === "templates"
      ? selectedTemplate
        ? templateDisplayTitle(selectedTemplate)
        : normalizeText(activeSelectionUri)
      : selectedResource
        ? resourceDisplayTitle(selectedResource)
        : normalizeText(activeSelectionUri);
  const fallbackToolNames = (selectedServer?.tools ?? [])
    .map((tool) => normalizeText(tool.title) || normalizeText(tool.name))
    .filter(Boolean);
  const fallbackParameterEntries =
    activeTab === "templates"
      ? buildTemplateParameterEntries(
          selectedTemplateAnalysis.variables,
          selectedTemplateDraft.values,
          selectedTemplateDraft.manualUri,
          resolvedTemplateUri
        )
      : [];
  const summaryResourceLabel =
    hasMatchingResult && mcpResourceStore.currentResult?.resourceLabel
      ? mcpResourceStore.currentResult.resourceLabel
      : fallbackResourceLabel;
  const summaryToolNames =
    hasMatchingResult && mcpResourceStore.currentResult ? (mcpResourceStore.currentResult.toolNames ?? []) : fallbackToolNames;
  const summaryParameterEntries =
    hasMatchingResult && mcpResourceStore.currentResult
      ? (mcpResourceStore.currentResult.parameterEntries ?? [])
      : fallbackParameterEntries;
  const serverStatusText = selectedServer
    ? [
        selectedServer.enabled ? "已启用" : "未启用",
        selectedServer.state === "connected"
          ? "已连接"
          : selectedServer.state === "error"
            ? "异常"
            : selectedServer.state === "disabled"
              ? "已禁用"
              : "待确认",
        typeof selectedServer.authenticated === "boolean"
          ? selectedServer.authenticated
            ? "已认证"
            : "未认证"
          : "",
        `资源 ${selectedServer.resources.length}`,
        `模板 ${selectedServer.resourceTemplates.length}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const threadHintText = currentThreadId ? "" : "读取 MCP 资源需要当前线程上下文；请先进入一个线程，再执行读取。";
  const isReading = mcpResourceStore.loadState === "loading";
  const canReadSelection = Boolean(selectedServer && currentThreadId && activeSelectionUri);

  const clearTemplateAutoReadTimer = () => {
    if (templateAutoReadTimerRef.current == null) return;
    window.clearTimeout(templateAutoReadTimerRef.current);
    templateAutoReadTimerRef.current = null;
  };

  const clearSelectionResult = () => {
    clearTemplateAutoReadTimer();
    mcpResourceStore.clearResult();
  };

  const ensureValidTabSelection = () => {
    const server = mcpStore.servers.find((entry) => entry.id === mcpResourceStore.selectedServerId) ?? null;
    if (!server) return;
    if (mcpResourceStore.activeTab === "resources") {
      const hasSelected = Boolean(server.resources.find((resource) => resource.uri === mcpResourceStore.selectedResourceUri));
      if (hasSelected) return;
      mcpResourceStore.selectResource(server.id, server.resources[0]?.uri ?? "");
      return;
    }
    const hasSelected = Boolean(
      server.resourceTemplates.find((template) => template.uriTemplate === mcpResourceStore.selectedTemplateKey)
    );
    if (hasSelected) return;
    mcpResourceStore.selectTemplate(server.id, server.resourceTemplates[0]?.uriTemplate ?? "");
  };

  const readUri = async (uriValue: string, force = false) => {
    const uri = normalizeText(uriValue);
    const server = selectedServer;
    const threadId = currentThreadId;
    const sourceTab = activeTab;
    const templateKey = sourceTab === "templates" ? mcpResourceStore.selectedTemplateKey : "";
    const requestKey = toReadTargetKey(threadId, server?.id ?? "", uri);
    if (!server || !uri) return;
    if (!threadId || !requestKey) {
      mcpResourceStore.clearResult();
      return;
    }
    if (!force && mcpResourceStore.hydrateFromCache(threadId, server.id, uri)) return;
    if (!force && inflightReadTargetKeyRef.current === requestKey) return;
    const requestSeq = latestReadSeqRef.current + 1;
    latestReadSeqRef.current = requestSeq;
    inflightReadTargetKeyRef.current = requestKey;
    mcpResourceStore.setLoadState("loading");
    try {
      const result = await runtime.readMcpResource({
        threadId,
        serverKey: server.id,
        uri,
        sourceTab,
        templateKey,
      });
      if (requestSeq !== latestReadSeqRef.current || currentSelectionReadKeyRef.current !== requestKey) return;
      mcpResourceStore.setCurrentResult({
        threadId,
        serverId: server.id,
        uri,
        contents: Array.isArray(result.contents) ? [...result.contents] : [],
        fetchedAt: Date.now(),
        resourceLabel: result.resourceLabel,
        toolNames: Array.isArray(result.toolNames) ? [...result.toolNames] : [],
        parameterEntries: Array.isArray(result.parameterEntries)
          ? result.parameterEntries.map((entry) => ({ ...entry }))
          : [],
      });
      mcpResourceStore.setLoadState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "读取失败");
      if (requestSeq !== latestReadSeqRef.current || currentSelectionReadKeyRef.current !== requestKey) return;
      mcpResourceStore.setCurrentResult(null, { cache: false });
      mcpResourceStore.setLoadState("error", message);
    } finally {
      if (inflightReadTargetKeyRef.current === requestKey) inflightReadTargetKeyRef.current = "";
    }
  };

  const scheduleAutoRead = (uriValue: string, opts?: { debounceMs?: number; force?: boolean }) => {
    const uri = normalizeText(uriValue);
    if (!selectedServer || !currentThreadId || !uri) {
      clearSelectionResult();
      return;
    }
    const debounceMs = Math.max(0, Math.round(Number(opts?.debounceMs ?? 0)));
    const trigger = () => {
      templateAutoReadTimerRef.current = null;
      void readUri(uri, Boolean(opts?.force));
    };
    clearTemplateAutoReadTimer();
    if (debounceMs > 0) {
      templateAutoReadTimerRef.current = window.setTimeout(trigger, debounceMs);
      return;
    }
    trigger();
  };

  useEffect(() => {
    if (mcpStore.servers.length === 0) {
      mcpResourceStore.resetState();
      return;
    }
    if (!selectedServer) mcpResourceStore.setSelectedServer(mcpStore.servers[0]?.id ?? "");
    else ensureValidTabSelection();
  }, [
    mcpStore.servers.map((server) => `${server.id}:${server.resources.length}:${server.resourceTemplates.length}`).join("|"),
    mcpResourceStore.selectedServerId,
  ]);

  useEffect(() => {
    ensureValidTabSelection();
  }, [mcpResourceStore.activeTab, mcpResourceStore.selectedServerId]);

  useEffect(() => {
    if (activeTab !== "resources") return;
    if (!mcpResourceStore.selectedResourceUri) {
      clearSelectionResult();
      return;
    }
    scheduleAutoRead(mcpResourceStore.selectedResourceUri);
  }, [currentThreadId, mcpResourceStore.selectedServerId, activeTab, mcpResourceStore.selectedResourceUri]);

  useEffect(() => {
    if (activeTab !== "templates") {
      clearTemplateAutoReadTimer();
      return;
    }
    if (!mcpResourceStore.selectedTemplateKey || !resolvedTemplateUri) {
      clearSelectionResult();
      return;
    }
    scheduleAutoRead(resolvedTemplateUri, { debounceMs: TEMPLATE_AUTOREAD_DEBOUNCE_MS });
  }, [currentThreadId, mcpResourceStore.selectedServerId, activeTab, mcpResourceStore.selectedTemplateKey, resolvedTemplateUri]);

  useEffect(() => {
    return () => clearTemplateAutoReadTimer();
  }, []);

  return (
    <section className={["mcp-resource-panel grid gap-3", className].filter(Boolean).join(" ")}>
      <div className="grid gap-2">
        <div className="grid gap-1.5">
          <div className="context-label dim">服务器（Server）</div>
          <SelectDropdown
            className="context-input mono w-full"
            modelValue={mcpResourceStore.selectedServerId}
            options={serverOptions}
            disabled={serverOptions.length === 0}
            minPopoverWidth={220}
            onValueChange={(next) => {
              mcpResourceStore.setSelectedServer(next);
              ensureValidTabSelection();
            }}
          />
        </div>

        {serverStatusText ? <div className="dim text-[12px] leading-[1.35]">{serverStatusText}</div> : null}

        <div className="inline-flex w-full items-center gap-1 rounded-full border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] p-1">
          <button
            type="button"
            className={["btn-mini flex-1", activeTab === "resources" ? "bg-[var(--bg-accent-soft)]" : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => mcpResourceStore.setActiveTab("resources")}
          >
            {`资源 ${selectedServer?.resources.length ?? 0}`}
          </button>
          <button
            type="button"
            className={["btn-mini flex-1", activeTab === "templates" ? "bg-[var(--bg-accent-soft)]" : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => mcpResourceStore.setActiveTab("templates")}
          >
            {`模板 ${selectedServer?.resourceTemplates.length ?? 0}`}
          </button>
        </div>

        {!selectedServer ? (
          <div className="rounded-[10px] border border-dashed border-[var(--ui-well-border)] px-3 py-2 text-[12px] leading-[1.35] text-[color:var(--text-muted)]">
            {"当前没有可用的 MCP 服务器。"}
          </div>
        ) : null}
      </div>

      {selectedServer ? (
        <>
          {activeTab === "resources" ? (
            <div className="grid gap-2">
              <div className="text-[12px] font-medium text-[color:var(--text-muted)]">
                {"可读资源"}
              </div>
              {selectedServer.resources.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-[var(--ui-well-border)] px-3 py-2 text-[12px] leading-[1.35] text-[color:var(--text-muted)]">
                  {"这个服务器当前没有暴露可直接读取的资源。"}
                </div>
              ) : (
                <div className="grid max-h-[190px] gap-1 overflow-y-auto pr-1 app-scrollbar">
                  {selectedServer.resources.map((resource) => (
                    <button
                      key={resource.uri}
                      type="button"
                      className={["grid gap-1 rounded-[10px] border px-2.5 py-2 text-left transition-colors", resourceCardClass(resource.uri === mcpResourceStore.selectedResourceUri)].join(" ")}
                      onClick={() => mcpResourceStore.selectResource(selectedServer.id, resource.uri)}
                    >
                      <div className="truncate text-[12px] font-medium">{resourceDisplayTitle(resource)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="text-[12px] font-medium text-[color:var(--text-muted)]">
                {"资源模板"}
              </div>
              {selectedServer.resourceTemplates.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-[var(--ui-well-border)] px-3 py-2 text-[12px] leading-[1.35] text-[color:var(--text-muted)]">
                  {"这个服务器当前没有暴露资源模板。"}
                </div>
              ) : (
                <div className="grid max-h-[190px] gap-1 overflow-y-auto pr-1 app-scrollbar">
                  {selectedServer.resourceTemplates.map((template) => (
                    <button
                      key={template.uriTemplate}
                      type="button"
                      className={["grid gap-1 rounded-[10px] border px-2.5 py-2 text-left transition-colors", resourceCardClass(template.uriTemplate === mcpResourceStore.selectedTemplateKey)].join(" ")}
                      onClick={() => mcpResourceStore.selectTemplate(selectedServer.id, template.uriTemplate)}
                    >
                      <div className="truncate text-[12px] font-medium">{templateDisplayTitle(template)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-2 rounded-[12px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] p-3">
            {activeTab === "resources" && selectedResource ? (
              <div className="grid gap-1">
                <div className="text-[12px] font-medium">{resourceDisplayTitle(selectedResource)}</div>
              </div>
            ) : activeTab === "templates" && selectedTemplate ? (
              <>
                <div className="grid gap-1">
                  <div className="text-[12px] font-medium">{templateDisplayTitle(selectedTemplate)}</div>
                </div>

                {selectedTemplateAnalysis.variables.length > 0 ? (
                  <div className="grid gap-2">
                    <div className="text-[12px] font-medium text-[color:var(--text-muted)]">
                      {"配置参数"}
                    </div>
                    <div className="grid gap-2">
                      {selectedTemplateAnalysis.variables.map((name) => (
                        <div key={name} className="grid gap-1">
                          <div className="context-label dim">{name}</div>
                          <input
                            className="context-input mono"
                            type="text"
                            value={selectedTemplateDraft.values[name] ?? ""}
                            placeholder={`填写 ${name}`}
                            onChange={(event) =>
                              mcpResourceStore.setTemplateField(mcpResourceStore.selectedTemplateKey, name, event.currentTarget.value)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-1">
                  <div className="context-label dim">{"展开预览"}</div>
                  <div className="rounded-[10px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] px-2.5 py-2 mono text-[11px] break-all">
                    {templatePreviewUri || "请先填写模板变量或手动输入 URI"}
                  </div>
                  {!selectedTemplateAnalysis.supported ? (
                    <div className="text-[11px] leading-[1.35] text-[color:var(--text-muted)]">
                      {"这个模板包含复杂 URI Template 语法，第一版不自动展开，建议直接填写最终 URI。"}
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-1">
                  <div className="context-label dim">{"手动 URI"}</div>
                  <input
                    className="context-input mono"
                    type="text"
                    value={selectedTemplateDraft.manualUri}
                    placeholder={templatePreviewUri || selectedTemplate.uriTemplate}
                    onChange={(event) =>
                      mcpResourceStore.setTemplateManualUri(mcpResourceStore.selectedTemplateKey, event.currentTarget.value)
                    }
                  />
                </div>
              </>
            ) : (
              <div className="text-[12px] leading-[1.4] text-[color:var(--text-muted)]">
                {activeTab === "resources"
                  ? "选择一个资源后即可读取内容。"
                  : "选择一个模板后即可填写变量并读取内容。"}
              </div>
            )}

            {threadHintText ? (
              <div className="rounded-[10px] border border-dashed border-[var(--ui-well-border)] px-3 py-2 text-[11px] leading-[1.35] text-[color:var(--text-muted)]">
                {threadHintText}
              </div>
            ) : null}

            {mcpResourceStore.loadState === "error" && mcpResourceStore.errorText ? (
              <div className="rounded-[10px] border border-[var(--border-danger)] bg-[var(--bg-danger-soft)] px-3 py-2 text-[11px] leading-[1.35] text-[var(--fg-danger)]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">{mcpResourceStore.errorText}</span>
                  <button type="button" className="btn-mini" disabled={!canReadSelection || isReading} onClick={() => void readUri(activeSelectionUri, true)}>
                    {"重试"}
                  </button>
                </div>
              </div>
            ) : null}

            {summaryResourceLabel ? (
              <div className="grid gap-2 rounded-[10px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] p-3">
                <div className="grid gap-1">
                  <div className="text-[12px] font-medium text-[color:var(--text-muted)]">
                    {"资源名"}
                  </div>
                  <div className="text-[12px] font-medium">{summaryResourceLabel}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-[12px] font-medium text-[color:var(--text-muted)]">
                    {"工具"}
                  </div>
                  {summaryToolNames.length === 0 ? (
                    <div className="mono dim text-[11px]">{"无工具"}</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {summaryToolNames.map((toolName) => (
                        <span
                          key={toolName}
                          className="inline-flex items-center rounded-[6px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] px-2 py-1 mono text-[11px]"
                        >
                          {toolName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid gap-1">
                  <div className="text-[12px] font-medium text-[color:var(--text-muted)]">
                    {"配置参数"}
                  </div>
                  {summaryParameterEntries.length === 0 ? (
                    <div className="mono dim text-[11px]">{"无配置参数"}</div>
                  ) : (
                    <div className="grid gap-1">
                      {summaryParameterEntries.map((entry) => (
                        <div
                          key={`${entry.key}:${entry.value}`}
                          className="rounded-[6px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] px-2.5 py-2"
                        >
                          <div className="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px]">
                            {entry.key}
                          </div>
                          <div className="mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px]">
                            {entry.value || "未填写"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {isReading ? (
                  <div className="mono dim inline-flex items-center gap-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px]">
                    <span className="running-indicator is-muted" aria-hidden="true" />
                    <span>{"读取中…"}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
