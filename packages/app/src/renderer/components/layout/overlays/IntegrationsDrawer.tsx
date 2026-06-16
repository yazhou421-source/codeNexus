import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeCodexMcpServerId } from "@codenexus/shared/codexMcp";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import type { McpServerState, SkillState } from "../../../domain/types";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useCodexConfigSwitcherStore } from "../../../stores/codexConfigSwitcher.store";
import { useCodexSkillRootsStore } from "../../../stores/codexSkillRoots.store";
import { useMcpResourceStore } from "../../../stores/mcpResource.store";
import { useMcpStore } from "../../../stores/mcp.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useSkillsStore } from "../../../stores/skills.store";
import { useSkillsUiStore } from "../../../stores/skillsUi.store";
import DetailDisclosure from "../../ui/DetailDisclosure";
import McpResourcePanel from "../../mcp/McpResourcePanel";
import SkillsList from "../skills/SkillsList";

type IntegrationsDrawerProps = {
  mode?: "drawer" | "settings";
  className?: string;
};

const MCP_JSON_SCHEMA_TEXT = '{"mcpServers": {...}}';

function mcpDotClass(server: McpServerState) {
  if (!server.enabled || server.state === "disabled") return "";
  if (server.state === "connected") return "state-connected";
  if (server.state === "connecting") return "state-connecting";
  if (server.state === "error") return "state-error";
  return "";
}

function mcpArgsLabel(server: McpServerState) {
  const args = server.args && server.args.length > 0 ? server.args : null;
  if (!args) return "";
  const raw = JSON.stringify(args);
  if (raw.length <= 180) return raw;
  return `${raw.slice(0, 90)} ... ${raw.slice(-70)}`;
}

export default function IntegrationsDrawer({ mode = "drawer", className }: IntegrationsDrawerProps) {
  const runtime = getRuntimeOrchestrator();
  const appShellStore = useAppShellStore();
  const runtimeStore = useRuntimeStore();
  const skillsStore = useSkillsStore();
  const skillsUiStore = useSkillsUiStore();
  const mcpStore = useMcpStore();
  const mcpResourceStore = useMcpResourceStore();
  const codexSkillRootsStore = useCodexSkillRootsStore();
  const codexConfigSwitcherStore = useCodexConfigSwitcherStore();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const [skillPendingPath, setSkillPendingPath] = useState("");
  const [skillRootInput, setSkillRootInput] = useState("");
  const [mcpPendingId, setMcpPendingId] = useState("");
  const [mcpOauthPendingId, setMcpOauthPendingId] = useState("");
  const [mcpConfigPending, setMcpConfigPending] = useState(false);
  const [switcherPending, setSwitcherPending] = useState(false);
  const [switcherSelectedProfileId, setSwitcherSelectedProfileId] = useState("");
  const [switcherErrorText, setSwitcherErrorText] = useState("");
  const [mcpJsonText, setMcpJsonText] = useState("");
  const [mcpJsonResultText, setMcpJsonResultText] = useState("");
  const [mcpJsonResultIsError, setMcpJsonResultIsError] = useState(false);
  const isSettings = mode === "settings";
  const open = isSettings || appShellStore.integrationsDrawerOpen;
  const activeTab = isSettings ? appShellStore.settingsIntegrationsTab : appShellStore.integrationsDrawerTab;
  const normalizedActiveTab = activeTab === "mcp" ? "mcp" : "skills";
  const setActiveTab = (next: "skills" | "mcp") =>
    isSettings ? appShellStore.setSettingsIntegrationsTab(next) : appShellStore.setIntegrationsDrawerTab(next);

  const totalSkillsCount = skillsStore.items.length;
  const enabledSkillsCount = useMemo(() => skillsStore.items.filter((skill) => skill.enabled).length, [skillsStore.items]);
  const totalMcpCount = mcpStore.servers.length;
  const connectedMcpCount = useMemo(
    () => mcpStore.servers.filter((server) => server.enabled && server.state === "connected").length,
    [mcpStore.servers]
  );
  const currentSkillRoots = codexSkillRootsStore.rootsForWorkspace(runtimeStore.workspacePath);
  const hasCcswitchConflict = Boolean(codexConfigSwitcherStore.ccswitch.detected);
  const ccswitchConflictPath = codexConfigSwitcherStore.ccswitch.databasePath || codexConfigSwitcherStore.ccswitch.dataDir;
  const canRefreshSkills =
    Boolean(runtimeStore.serverId) && Boolean(runtimeStore.workspacePath) && skillsStore.loadState !== "loading";
  const canOpenSkillsManager = Boolean(runtimeStore.serverId) || Boolean(runtimeStore.workspacePath) || skillsStore.items.length > 0;
  const canMutateSkillRoots = Boolean(String(runtimeStore.workspacePath ?? "").trim()) && !codexSkillRootsStore.saving;
  const canAddSkillRoot = canMutateSkillRoots && Boolean(skillRootInput.trim());
  const canRefreshMcp = Boolean(runtimeStore.serverId) && mcpStore.loadState !== "loading";
  const canReloadMcp = Boolean(runtimeStore.serverId) && mcpStore.loadState !== "loading";
  const canWriteMcpConfig = Boolean(runtimeStore.serverId) && !mcpConfigPending && !hasCcswitchConflict;
  const canManageSwitcher = Boolean(runtimeStore.serverId) && !switcherPending;
  const canActivateSwitcherProfile = canManageSwitcher && Boolean(String(switcherSelectedProfileId ?? "").trim());

  const close = () => {
    if (isSettings) return;
    appShellStore.setIntegrationsDrawerOpen(false);
  };

  const openSkillsManager = () => {
    close();
    skillsUiStore.openManager();
  };

  const skillsStateText = () => {
    if (!runtimeStore.serverId) return "未连接服务";
    if (!runtimeStore.workspacePath) return "未选择工作区";
    if (skillsStore.loadState === "loading") return "加载中…";
    if (skillsStore.loadState === "error")
      return skillsStore.errorText ? `加载失败：${skillsStore.errorText}` : "加载失败";
    if (skillsStore.items.length === 0) {
      if (skillsStore.parseErrors.length > 0) return `暂无可用技能（errors=${skillsStore.parseErrors.length}）`;
      return "暂无可用技能";
    }
    return "";
  };

  const activeHintText = () => {
    if (normalizedActiveTab === "skills") {
      const state = skillsStateText();
      return state || "按需启用，保持精简。";
    }
    if (!runtimeStore.serverId) return "未连接服务";
    if (mcpStore.loadState === "loading") return "加载中…";
    if (mcpStore.loadState === "error")
      return mcpStore.errorText ? `加载失败：${mcpStore.errorText}` : "加载失败";
    return "按需启用，减少依赖。";
  };

  const mcpStateText = () => {
    if (!runtimeStore.serverId) return "未连接服务";
    if (mcpStore.loadState === "loading") return "加载中…";
    if (mcpStore.loadState === "error")
      return mcpStore.errorText ? `加载失败：${mcpStore.errorText}` : "加载失败";
    if (mcpStore.servers.length === 0) return "暂无 MCP 配置";
    return "";
  };

  const switcherStatusText = () => {
    if (codexConfigSwitcherStore.loadState === "loading") return "加载中…";
    if (codexConfigSwitcherStore.loadState === "error") return codexConfigSwitcherStore.errorText;
    const active = codexConfigSwitcherStore.activeProfile;
    const count = codexConfigSwitcherStore.profiles.length;
    const target = codexConfigSwitcherStore.codexConfigPath || "~/.codex/config.toml";
    if (!active) return `未接管配置；目标：${target}`;
    return `当前：${active.name}；配置集 ${count} 个；目标：${target}`;
  };

  const mcpStateLabel = (server: McpServerState) => {
    if (!server.enabled) return "未启用";
    if (server.state === "connected") return "已连接";
    if (server.state === "connecting") return "连接中";
    if (server.state === "error") return "异常";
    if (server.state === "disabled") return "已禁用";
    return server.state ? String(server.state) : "未知";
  };

  const mcpTransportLabel = (server: McpServerState) => {
    if (server.url) return String(server.url);
    if (server.command) return `cmd=${String(server.command)}`;
    return "未知";
  };

  const mcpSummarySubtext = (server: McpServerState) => {
    const transport = mcpTransportLabel(server);
    if (!transport || transport === "未知") return "";
    return transport;
  };

  const onAddSkillRoot = async () => {
    const root = skillRootInput.trim();
    if (!root) return;
    await runtime.addSkillRoot(root);
    setSkillRootInput("");
  };

  const onPickSkillRoot = async () => {
    if (!canMutateSkillRoots) return;
    const root = await codexDesktop.workspace.select();
    if (!root) return;
    await runtime.addSkillRoot(root);
  };

  const onToggleSkill = async ({ skill, enabled }: { skill: SkillState; enabled: boolean }) => {
    const path = String(skill.path ?? "").trim();
    if (!path || !skill.configurable || skillPendingPath === path) return;
    setSkillPendingPath(path);
    try {
      await runtime.toggleSkill(path, enabled);
    } finally {
      setSkillPendingPath("");
    }
  };

  const onImportCurrentCodexConfig = async () => {
    setSwitcherPending(true);
    setSwitcherErrorText("");
    try {
      await runtime.importCurrentCodexConfigProfile();
      setSwitcherSelectedProfileId(codexConfigSwitcherStore.state.activeProfileId ?? "");
    } catch (error: any) {
      setSwitcherErrorText(String(error?.message ?? error ?? "导入失败"));
    } finally {
      setSwitcherPending(false);
    }
  };

  const onActivateSwitcherProfile = async () => {
    const id = String(switcherSelectedProfileId ?? "").trim();
    if (!id) return;
    setSwitcherPending(true);
    setSwitcherErrorText("");
    try {
      await runtime.activateCodexConfigProfile(id);
    } catch (error: any) {
      setSwitcherErrorText(String(error?.message ?? error ?? "激活失败"));
    } finally {
      setSwitcherPending(false);
    }
  };

  const onImportMcpJson = async () => {
    setMcpJsonResultText("");
    setMcpJsonResultIsError(false);
    const text = mcpJsonText.trim();
    if (!text) {
      setMcpJsonResultText("请输入 JSON。");
      setMcpJsonResultIsError(true);
      return;
    }
    setMcpConfigPending(true);
    try {
      const res = await runtime.importMcpServersFromJson(text);
      setMcpJsonResultIsError(res.imported === 0 || res.errors.length > 0);
      setMcpJsonResultText(
        res.errors.length > 0
          ? `已导入 ${res.imported} 个；错误：${res.errors.join("; ")}`
          : `已导入 ${res.imported} 个 MCP。`
      );
      if (res.imported > 0) setMcpJsonText("");
    } catch (error: any) {
      setMcpJsonResultIsError(true);
      setMcpJsonResultText(String(error?.message ?? error ?? "导入失败"));
    } finally {
      setMcpConfigPending(false);
    }
  };

  const onToggleMcp = async (serverId: string, enabled: boolean) => {
    if (hasCcswitchConflict || !serverId || mcpPendingId === serverId) return;
    setMcpPendingId(serverId);
    try {
      await runtime.toggleMcpEnabled(serverId, enabled);
    } finally {
      setMcpPendingId("");
    }
  };

  const onMcpOAuth = async (serverId: string) => {
    if (!serverId || mcpOauthPendingId === serverId) return;
    setMcpOauthPendingId(serverId);
    try {
      await runtime.startMcpOAuthLogin(serverId);
    } finally {
      setMcpOauthPendingId("");
    }
  };

  const onDeleteMcpServer = async (serverId: string) => {
    if (hasCcswitchConflict) return;
    const id = normalizeCodexMcpServerId(serverId);
    if (!id) return;
    if (!window.confirm(`删除 MCP「${id}」？`)) return;
    setMcpConfigPending(true);
    try {
      await runtime.deleteMcpServer(id);
    } finally {
      setMcpConfigPending(false);
    }
  };

  const onOpenMcpResources = (serverId: string) => {
    const id = String(serverId ?? "").trim();
    if (!id) return;
    mcpResourceStore.requestOpen(id, "resources");
    appShellStore.openSettings("integrations", { integrationsTab: "mcp" });
  };

  useEffect(() => {
    if (!open) return;
    if (codexSkillRootsStore.loadState === "idle") void codexSkillRootsStore.refresh();
    if (codexConfigSwitcherStore.loadState === "idle") void runtime.refreshCodexConfigSwitcher();
    if (runtimeStore.serverId) {
      void runtime.refreshMcp();
      void runtime.refreshSkills(false);
    }
    window.setTimeout(() => closeBtnRef.current?.focus(), 0);
  }, [open, runtimeStore.serverId]);

  useEffect(() => {
    if (!open) return;
    if (normalizedActiveTab === "skills") {
      if (runtimeStore.serverId) void runtime.refreshSkills(false);
      return;
    }
    if (codexConfigSwitcherStore.loadState === "idle") void runtime.refreshCodexConfigSwitcher();
    if (runtimeStore.serverId) void runtime.refreshMcp();
  }, [open, normalizedActiveTab, runtimeStore.serverId]);

  useEffect(() => {
    setSwitcherSelectedProfileId(codexConfigSwitcherStore.state.activeProfileId ?? "");
  }, [codexConfigSwitcherStore.state.activeProfileId]);

  if (!open) return null;

  const activeChipText =
    normalizedActiveTab === "skills" ? `Skills ${enabledSkillsCount}/${totalSkillsCount}` : `MCP ${connectedMcpCount}/${totalMcpCount}`;
  const activeChipClass =
    normalizedActiveTab === "skills" ? (enabledSkillsCount > 0 ? "ok" : "warn") : connectedMcpCount > 0 ? "ok" : "warn";
  const currentMcpStateText = mcpStateText();

  const panel = (
    <section className={["global-config-drawer-panel", className].filter(Boolean).join(" ")} onClick={(event) => event.stopPropagation()}>
      <header className="global-config-drawer-head">
        <div className="integrations-head-grid">
          <div className="integrations-head-left">
            <div className="panel-title">扩展能力</div>
          </div>
          <div className="integrations-head-center">
            <div className="integrations-tabs">
              <button
                className={`integrations-tab mono${normalizedActiveTab === "skills" ? " is-active" : ""}`}
                type="button"
                onClick={() => setActiveTab("skills")}
              >
                Skills
              </button>
              <button
                className={`integrations-tab mono${normalizedActiveTab === "mcp" ? " is-active" : ""}`}
                type="button"
                onClick={() => setActiveTab("mcp")}
              >
                MCP
              </button>
            </div>
          </div>
          <div className="integrations-head-right">
            <span className={`status-chip mono integrations-head-chip ${activeChipClass}`}>{activeChipText}</span>
            {!isSettings ? (
              <button ref={closeBtnRef} className="btn-mini" type="button" onClick={close}>
                关闭
              </button>
            ) : null}
          </div>
        </div>
      </header>
      <div className={`global-config-drawer-body app-scrollbar${isSettings ? " is-settings" : ""}`}>
        <div className="panel integrations-panel">
          <div className="integrations-toolbar">
            <div className="integrations-toolbar-hint mono dim">{activeHintText()}</div>
            <div className="row integrations-toolbar-actions">
              {normalizedActiveTab === "skills" ? (
                <>
                  <button className="btn-mini" type="button" disabled={!canOpenSkillsManager} onClick={openSkillsManager}>
                    管理器
                  </button>
                  <button className="btn-mini" type="button" disabled={!canRefreshSkills} onClick={() => void runtime.refreshSkills(true)}>
                    刷新
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-mini" type="button" disabled={!canRefreshMcp} onClick={() => void runtime.refreshMcp()}>
                    刷新
                  </button>
                  <button className="btn-mini" type="button" disabled={!canReloadMcp} onClick={() => void runtime.reloadMcpConfig()}>
                    重载
                  </button>
                </>
              )}
            </div>
          </div>

          {normalizedActiveTab === "skills" ? (
            <div>
              <section className="integrations-config-section">
                <div className="integrations-section-head">
                  <div>
                    <div className="integrations-mcp-section-title">本地 Skills Roots</div>
                    <div className="integrations-section-subtitle dim">仅对当前工作区追加扫描目录。</div>
                  </div>
                  <button className="btn-mini" type="button" disabled={!canMutateSkillRoots} onClick={() => void onPickSkillRoot()}>
                    选择目录
                  </button>
                </div>
                <div className="integrations-root-add">
                  <input
                    className="context-input mono"
                    type="text"
                    value={skillRootInput}
                    placeholder="D:\\path\\to\\skills"
                    disabled={!canMutateSkillRoots}
                    onChange={(event) => setSkillRootInput(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      void onAddSkillRoot();
                    }}
                  />
                  <button className="btn-mini" type="button" disabled={!canAddSkillRoot} onClick={() => void onAddSkillRoot()}>
                    添加
                  </button>
                </div>
                {currentSkillRoots.length > 0 ? (
                  <div className="integrations-root-list">
                    {currentSkillRoots.map((root) => (
                      <div key={root} className="integrations-root-row">
                        <span className="mono">{root}</span>
                        <button
                          className="btn-mini"
                          type="button"
                          disabled={codexSkillRootsStore.saving}
                          onClick={() => void runtime.removeSkillRoot(root)}
                        >
                          移除
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="integrations-section-subtitle dim">当前工作区未配置额外 Skills 目录。</div>
                )}
              </section>

              <SkillsList
                items={skillsStore.items}
                pendingPath={skillPendingPath}
                stateText={skillsStateText()}
                emptyText="暂无可用技能"
                mode="compact"
                onToggleSkill={onToggleSkill}
              />
            </div>
          ) : (
            <div className="integrations-mcp-tab">
              <section className="integrations-config-section">
                <div className="integrations-section-head">
                  <div>
                    <div className="integrations-mcp-section-title">Codex 配置切换器</div>
                    <div className="integrations-section-subtitle dim">以本地受管配置集为准，激活后写入 Codex 用户配置。</div>
                  </div>
                  <div className="row integrations-inline-actions">
                    <button
                      className="btn-mini"
                      type="button"
                      disabled={!canManageSwitcher || hasCcswitchConflict}
                      onClick={() => void onImportCurrentCodexConfig()}
                    >
                      导入当前
                    </button>
                    <button
                      className="btn-mini"
                      type="button"
                      disabled={!canActivateSwitcherProfile || hasCcswitchConflict}
                      onClick={() => void onActivateSwitcherProfile()}
                    >
                      激活
                    </button>
                  </div>
                </div>
                <div className="integrations-root-add">
                  <select
                    className="context-input mono"
                    value={switcherSelectedProfileId}
                    disabled={!canManageSwitcher || hasCcswitchConflict || codexConfigSwitcherStore.profiles.length === 0}
                    onChange={(event) => setSwitcherSelectedProfileId(event.currentTarget.value)}
                  >
                    <option value="">暂无受管配置集</option>
                    {codexConfigSwitcherStore.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="integrations-section-subtitle mono dim">{switcherStatusText()}</div>
                {hasCcswitchConflict ? (
                  <div className="integrations-section-subtitle mono is-error">
                    {`检测到 ccswitch（${ccswitchConflictPath}）。建议继续通过 ccswitch 管理 Codex 配置；如需改用 CodeNexus，请先删除或停用 ccswitch 后再启用全局切换器。`}
                  </div>
                ) : null}
                {switcherErrorText ? <div className="integrations-section-subtitle mono is-error">{switcherErrorText}</div> : null}
              </section>

              <section className="integrations-config-section">
                <div className="integrations-section-head">
                  <div>
                    <div className="integrations-mcp-section-title">MCP JSON 导入</div>
                    <div className="integrations-section-subtitle dim">
                      {`支持 ${MCP_JSON_SCHEMA_TEXT} 或单个 server JSON。`}
                    </div>
                  </div>
                  <button className="btn-mini" type="button" disabled={!canWriteMcpConfig} onClick={() => void onImportMcpJson()}>
                    导入
                  </button>
                </div>
                <textarea
                  className="context-input integrations-json-textarea mono"
                  value={mcpJsonText}
                  placeholder='{"mcpServers":{"filesystem":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}}}'
                  disabled={!canWriteMcpConfig}
                  onChange={(event) => setMcpJsonText(event.currentTarget.value)}
                />
                {mcpJsonResultText ? (
                  <div className={`integrations-section-subtitle mono${mcpJsonResultIsError ? " is-error" : ""}`}>{mcpJsonResultText}</div>
                ) : null}
              </section>

              <section className="integrations-mcp-resource">
                <div className="integrations-mcp-section-title">资源查看</div>
                <McpResourcePanel />
              </section>

              {currentMcpStateText ? (
                <div className="mcp-list dim">{currentMcpStateText}</div>
              ) : (
                <div className="mcp-list">
                  {mcpStore.servers.map((server) => (
                    <DetailDisclosure
                      key={server.id}
                      className="mcp-details"
                      summaryClass="mcp-summary"
                      summary={({ open: detailsOpen }) => (
                        <>
                          <label className="skill-switch">
                            <input
                              className="skill-switch-input"
                              type="checkbox"
                              checked={server.enabled}
                              disabled={mcpPendingId === server.id || hasCcswitchConflict}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => void onToggleMcp(server.id, event.currentTarget.checked)}
                            />
                            <span className="skill-switch-track" aria-hidden="true">
                              <span className="skill-switch-thumb" />
                            </span>
                          </label>
                          <div className={`mcp-dot ${mcpDotClass(server)}`} />
                          <div className="mcp-title-wrap">
                            <div className="mcp-title">{server.id}</div>
                            {mcpSummarySubtext(server) ? <div className="mcp-subtitle mono dim">{mcpSummarySubtext(server)}</div> : null}
                          </div>
                          <div className={`chevron${detailsOpen ? " open" : ""}`} aria-hidden="true">
                            ▸
                          </div>
                        </>
                      )}
                    >
                      <div className="mcp-body">
                        <div className="mcp-meta">
                          <div className="mcp-meta-row">
                            <div className="mcp-meta-key dim">状态</div>
                            <div className="mcp-meta-val mono">{mcpStateLabel(server)}</div>
                          </div>
                          <div className="mcp-meta-row">
                            <div className="mcp-meta-key dim">传输</div>
                            <div className="mcp-meta-val mono">{mcpTransportLabel(server)}</div>
                          </div>
                          {mcpArgsLabel(server) ? (
                            <div className="mcp-meta-row">
                              <div className="mcp-meta-key dim">参数</div>
                              <div className="mcp-meta-val mono">{mcpArgsLabel(server)}</div>
                            </div>
                          ) : null}
                          {typeof server.authenticated === "boolean" ? (
                            <div className="mcp-meta-row">
                              <div className="mcp-meta-key dim">认证</div>
                              <div className="mcp-meta-val mono">
                                {server.authenticated ? "已认证" : "未认证"}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        {server.message ? (
                          <div className={`mcp-message mono${server.state === "error" ? " is-error" : ""}`}>{server.message}</div>
                        ) : null}
                        <div className="mcp-actions">
                          <button type="button" className="btn-mini" onClick={() => onOpenMcpResources(server.id)}>
                            查看资源
                          </button>
                          <button
                            type="button"
                            className="btn-mini"
                            disabled={!server.enabled || mcpOauthPendingId === server.id}
                            onClick={() => void onMcpOAuth(server.id)}
                          >
                            OAuth 登录
                          </button>
                          <button
                            type="button"
                            className="btn-mini danger"
                            disabled={hasCcswitchConflict}
                            onClick={() => void onDeleteMcpServer(server.id)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </DetailDisclosure>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );

  if (isSettings) return <div className="global-config-drawer-overlay is-settings">{panel}</div>;
  return (
    <div className="global-config-drawer-overlay" role="dialog" aria-modal="true" aria-label="扩展能力" onClick={close}>
      <div className="global-config-drawer-backdrop" onClick={close} />
      {panel}
    </div>
  );
}
