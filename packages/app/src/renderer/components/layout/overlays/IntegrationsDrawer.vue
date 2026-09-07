<template>
  <Teleport to="body" :disabled="isSettings">
    <Transition name="global-config-drawer">
      <div
        v-if="open"
        class="global-config-drawer-overlay"
        :class="{ 'is-settings': isSettings }"
        role="dialog"
        aria-modal="true"
        :aria-label="t('integrations.aria')"
        @click.self="onOverlayClick"
      >
        <div v-if="!isSettings" class="global-config-drawer-backdrop" @click="close"></div>
        <section class="global-config-drawer-panel" @click.stop>
          <header class="global-config-drawer-head">
            <!--
              Three-zone header: left title, centered tabs, right status/actions.
              Keeps tabs centered when the right-side content changes width.
            -->
            <div class="integrations-head-grid">
              <div class="integrations-head-left">
                <div class="panel-title">{{ t("integrations.title") }}</div>
              </div>
              <div class="integrations-head-center">
                <div class="integrations-tabs">
                  <button
                    type="button"
                    class="integrations-tab mono"
                    :class="{ 'is-active': activeTab === 'skills' }"
                    @click="activeTab = 'skills'"
                  >
                    Skills
                  </button>
                  <button
                    type="button"
                    class="integrations-tab mono"
                    :class="{ 'is-active': activeTab === 'mcp' }"
                    @click="activeTab = 'mcp'"
                  >
                    MCP
                  </button>
                </div>
              </div>
              <div class="integrations-head-right">
                <span class="status-chip mono integrations-head-chip" :class="activeChipClass">{{
                  activeChipText
                }}</span>
                <button v-if="!isSettings" ref="closeBtnRef" class="btn-mini" type="button" @click="close">
                  {{ t("integrations.close") }}
                </button>
              </div>
            </div>
          </header>

          <div class="global-config-drawer-body app-scrollbar" :class="{ 'is-settings': isSettings }">
            <div class="panel integrations-panel">
              <div class="integrations-toolbar">
                <div class="integrations-toolbar-hint mono dim">{{ activeHintText }}</div>
                <div class="row integrations-toolbar-actions" style="gap: 6px">
                  <template v-if="activeTab === 'skills'">
                    <button class="btn-mini" type="button" :disabled="!canOpenSkillsManager" @click="openSkillsManager">
                      {{ t("skills.manager") }}
                    </button>
                    <button class="btn-mini" type="button" :disabled="!canRefreshSkills" @click="onRefreshSkills">
                      {{ t("skills.refresh") }}
                    </button>
                  </template>
                  <template v-else>
                    <button class="btn-mini" type="button" :disabled="!canRefreshMcp" @click="runtime.refreshMcp">
                      {{ t("skills.refresh") }}
                    </button>
                    <button class="btn-mini" type="button" :disabled="!canReloadMcp" @click="runtime.reloadMcpConfig">
                      {{ t("integrations.reload") }}
                    </button>
                  </template>
                </div>
              </div>

              <div v-if="activeTab === 'skills'">
                <section class="integrations-config-section">
                  <div class="integrations-section-head">
                    <div>
                      <div class="integrations-mcp-section-title">{{ t("integrations.skillRootsTitle") }}</div>
                      <div class="integrations-section-subtitle dim">{{ t("integrations.skillRootsSubtitle") }}</div>
                    </div>
                    <button class="btn-mini" type="button" :disabled="!canMutateSkillRoots" @click="onPickSkillRoot">
                      {{ t("integrations.chooseDirectory") }}
                    </button>
                  </div>
                  <div class="integrations-root-add">
                    <input
                      v-model="skillRootInput"
                      class="context-input mono"
                      type="text"
                      placeholder="D:\path\to\skills"
                      :disabled="!canMutateSkillRoots"
                      @keydown.enter.prevent="onAddSkillRoot"
                    />
                    <button class="btn-mini" type="button" :disabled="!canAddSkillRoot" @click="onAddSkillRoot">
                      {{ t("integrations.add") }}
                    </button>
                  </div>
                  <div v-if="currentSkillRoots.length > 0" class="integrations-root-list">
                    <div v-for="root in currentSkillRoots" :key="root" class="integrations-root-row">
                      <span class="mono">{{ root }}</span>
                      <button
                        class="btn-mini"
                        type="button"
                        :disabled="codexSkillRootsStore.saving"
                        @click="onRemoveSkillRoot(root)"
                      >
                        {{ t("integrations.remove") }}
                      </button>
                    </div>
                  </div>
                  <div v-else class="integrations-section-subtitle dim">{{ t("integrations.noSkillRoots") }}</div>
                </section>

                <SkillsList
                  :items="skillsStore.items"
                  :pendingPath="skillPendingPath"
                  :stateText="skillsStateText"
                  :emptyText="t('skills.empty')"
                  mode="compact"
                  @toggle-skill="onSkillToggleRequest"
                />
              </div>

              <div v-else>
                <div class="integrations-mcp-tab">
                  <section class="integrations-config-section">
                    <div class="integrations-section-head">
                      <div>
                        <div class="integrations-mcp-section-title">{{ t("integrations.switcherTitle") }}</div>
                        <div class="integrations-section-subtitle dim">
                          {{ t("integrations.switcherSubtitle") }}
                        </div>
                      </div>
                      <div class="row" style="gap: 6px">
                        <button
                          class="btn-mini"
                          type="button"
                          :disabled="!canManageSwitcher || hasCcswitchConflict"
                          @click="onImportCurrentCodexConfig"
                        >
                          {{ t("integrations.importCurrent") }}
                        </button>
                        <button
                          class="btn-mini"
                          type="button"
                          :disabled="!canActivateSwitcherProfile || hasCcswitchConflict"
                          @click="onActivateSwitcherProfile"
                        >
                          {{ t("integrations.activate") }}
                        </button>
                      </div>
                    </div>
                    <div class="integrations-root-add">
                      <select
                        v-model="switcherSelectedProfileId"
                        class="context-input mono"
                        :disabled="
                          !canManageSwitcher || hasCcswitchConflict || codexConfigSwitcherStore.profiles.length === 0
                        "
                      >
                        <option value="">{{ t("integrations.noManagedProfile") }}</option>
                        <option
                          v-for="profile in codexConfigSwitcherStore.profiles"
                          :key="profile.id"
                          :value="profile.id"
                        >
                          {{ profile.name }}
                        </option>
                      </select>
                    </div>
                    <div class="integrations-section-subtitle mono dim">
                      {{ switcherStatusText }}
                    </div>
                    <div
                      v-if="hasCcswitchConflict"
                      class="integrations-section-subtitle mono"
                      :class="{ 'is-error': true }"
                    >
                      {{ ccswitchConflictText }}
                    </div>
                    <div
                      v-if="switcherErrorText"
                      class="integrations-section-subtitle mono"
                      :class="{ 'is-error': true }"
                    >
                      {{ switcherErrorText }}
                    </div>
                  </section>

                  <section class="integrations-config-section">
                    <div class="integrations-section-head">
                      <div>
                        <div class="integrations-mcp-section-title">{{ t("integrations.mcpJsonImport") }}</div>
                        <div class="integrations-section-subtitle dim">
                          {{ t("integrations.mcpJsonImportDesc", { schema: mcpJsonSchemaText }) }}
                        </div>
                      </div>
                      <button class="btn-mini" type="button" :disabled="!canWriteMcpConfig" @click="onImportMcpJson">
                        {{ t("integrations.import") }}
                      </button>
                    </div>
                    <textarea
                      v-model="mcpJsonText"
                      class="context-input integrations-json-textarea mono"
                      placeholder='{"mcpServers":{"filesystem":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}}}'
                      :disabled="!canWriteMcpConfig"
                    ></textarea>
                    <div
                      v-if="mcpJsonResultText"
                      class="integrations-section-subtitle mono"
                      :class="{ 'is-error': mcpJsonResultIsError }"
                    >
                      {{ mcpJsonResultText }}
                    </div>
                  </section>

                  <section class="integrations-mcp-resource">
                    <div class="integrations-mcp-section-title">{{ t("integrations.resources") }}</div>
                    <McpResourcePanel />
                  </section>

                  <div v-if="mcpStateText" class="mcp-list dim">{{ mcpStateText }}</div>
                  <div v-else class="mcp-list">
                    <DetailDisclosure
                      v-for="server in mcpStore.servers"
                      :key="server.id"
                      class="mcp-details"
                      summaryClass="mcp-summary"
                    >
                      <template #summary="{ open: detailsOpen }">
                        <label class="skill-switch">
                          <input
                            class="skill-switch-input"
                            type="checkbox"
                            :aria-label="server.id"
                            :checked="server.enabled"
                            :disabled="mcpPendingId === server.id || hasCcswitchConflict"
                            @click.stop
                            @change="onMcpEnabledChanged(server.id, $event)"
                          />
                          <span class="skill-switch-track" aria-hidden="true">
                            <span class="skill-switch-thumb"></span>
                          </span>
                        </label>
                        <div class="mcp-dot" :class="mcpDotClass(server)"></div>
                        <div class="mcp-title-wrap">
                          <div class="mcp-title">{{ server.id }}</div>
                          <div v-if="mcpSummarySubtext(server)" class="mcp-subtitle mono dim">
                            {{ mcpSummarySubtext(server) }}
                          </div>
                        </div>
                        <div class="chevron" :class="{ open: detailsOpen }" aria-hidden="true">▸</div>
                      </template>
                      <div class="mcp-body">
                        <div class="mcp-meta">
                          <div class="mcp-meta-row">
                            <div class="mcp-meta-key dim">{{ t("integrations.status") }}</div>
                            <div class="mcp-meta-val mono">{{ mcpStateLabel(server) }}</div>
                          </div>
                          <div class="mcp-meta-row">
                            <div class="mcp-meta-key dim">{{ t("integrations.transport") }}</div>
                            <div class="mcp-meta-val mono">{{ mcpTransportLabel(server) }}</div>
                          </div>
                          <div v-if="mcpArgsLabel(server)" class="mcp-meta-row">
                            <div class="mcp-meta-key dim">{{ t("integrations.params") }}</div>
                            <div class="mcp-meta-val mono">{{ mcpArgsLabel(server) }}</div>
                          </div>
                          <div v-if="typeof server.authenticated === 'boolean'" class="mcp-meta-row">
                            <div class="mcp-meta-key dim">{{ t("integrations.auth") }}</div>
                            <div class="mcp-meta-val mono">
                              {{
                                server.authenticated
                                  ? t("integrations.authenticated")
                                  : t("integrations.unauthenticated")
                              }}
                            </div>
                          </div>
                        </div>

                        <div
                          v-if="server.message"
                          class="mcp-message mono"
                          :class="{ 'is-error': server.state === 'error' }"
                        >
                          {{ server.message }}
                        </div>
                        <div class="mcp-actions">
                          <button type="button" class="btn-mini" @click.prevent.stop="onOpenMcpResources(server.id)">
                            {{ t("integrations.viewResources") }}
                          </button>
                          <button
                            type="button"
                            class="btn-mini"
                            :disabled="!server.enabled || mcpOauthPendingId === server.id"
                            @click.prevent.stop="onMcpOAuth(server.id)"
                          >
                            {{ t("integrations.oauthLogin") }}
                          </button>
                          <button
                            type="button"
                            class="btn-mini danger"
                            :disabled="hasCcswitchConflict"
                            @click.prevent.stop="onDeleteMcpServer(server.id)"
                          >
                            {{ t("integrations.delete") }}
                          </button>
                        </div>
                      </div>
                    </DetailDisclosure>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { codexDesktop } from "../../../api/codexDesktopClient";
import McpResourcePanel from "../../mcp/McpResourcePanel.vue";
import DetailDisclosure from "../../ui/DetailDisclosure.vue";
import SkillsList from "../skills/SkillsList.vue";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useSkillsStore } from "../../../stores/skills.store";
import { useSkillsUiStore } from "../../../stores/skillsUi.store";
import { useMcpStore } from "../../../stores/mcp.store";
import { useMcpResourceStore } from "../../../stores/mcpResource.store";
import { useCodexSkillRootsStore } from "../../../stores/codexSkillRoots.store";
import { useCodexConfigSwitcherStore } from "../../../stores/codexConfigSwitcher.store";
import type { McpServerState, SkillState } from "../../../domain/types";
import { normalizeCodexMcpServerId } from "@codenexus/shared/codexMcp";

const runtime = getRuntimeOrchestrator();
const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const appShellStore = useAppShellStore();
const skillsStore = useSkillsStore();
const skillsUiStore = useSkillsUiStore();
const mcpStore = useMcpStore();
const mcpResourceStore = useMcpResourceStore();
const codexSkillRootsStore = useCodexSkillRootsStore();
const codexConfigSwitcherStore = useCodexConfigSwitcherStore();
const mcpJsonSchemaText = '{"mcpServers": {...}}';

const props = defineProps<{ mode?: "drawer" | "settings" }>();
const isSettings = computed(() => props.mode === "settings");
const open = computed(() => (isSettings.value ? true : appShellStore.integrationsDrawerOpen));
const activeTab = computed<"skills" | "mcp">({
  get: () => {
    const raw = isSettings.value ? appShellStore.settingsIntegrationsTab : appShellStore.integrationsDrawerTab;
    return raw === "mcp" ? "mcp" : "skills";
  },
  set: (next) => {
    if (isSettings.value) {
      appShellStore.setSettingsIntegrationsTab(next);
      return;
    }
    appShellStore.setIntegrationsDrawerTab(next);
  },
});

const closeBtnRef = ref<HTMLButtonElement | null>(null);

function close() {
  if (isSettings.value) return;
  appShellStore.setIntegrationsDrawerOpen(false);
}

function onOverlayClick() {
  if (isSettings.value) return;
  close();
}

function openSkillsManager() {
  // 页面模式：打开管理器时自动收起抽屉，避免叠层与焦点混乱。
  close();
  skillsUiStore.openManager();
}

const totalSkillsCount = computed(() => skillsStore.items.length);
const enabledSkillsCount = computed(() => skillsStore.items.filter((s) => s.enabled).length);

const totalMcpCount = computed(() => mcpStore.servers.length);
const connectedMcpCount = computed(() => mcpStore.servers.filter((s) => s.enabled && s.state === "connected").length);

const skillsChipClass = computed(() => (enabledSkillsCount.value > 0 ? "ok" : "warn"));
const mcpChipClass = computed(() => (connectedMcpCount.value > 0 ? "ok" : "warn"));

const activeChipClass = computed(() => (activeTab.value === "skills" ? skillsChipClass.value : mcpChipClass.value));
const activeChipText = computed(() => {
  if (activeTab.value === "skills") return `Skills ${enabledSkillsCount.value}/${totalSkillsCount.value}`;
  return `MCP ${connectedMcpCount.value}/${totalMcpCount.value}`;
});

const activeHintText = computed(() => {
  if (activeTab.value === "skills") {
    if (!runtimeStore.serverId) return t("skills.disconnected");
    if (!runtimeStore.workspacePath) return t("skills.noWorkspace");
    if (skillsStore.loadState === "loading") return t("skills.loading");
    if (skillsStore.loadState === "error")
      return skillsStore.errorText
        ? t("skills.loadFailedWithMessage", { message: skillsStore.errorText })
        : t("skills.loadFailed");
    return t("integrations.skillsReadyHint");
  }
  if (!runtimeStore.serverId) return t("skills.disconnected");
  if (mcpStore.loadState === "loading") return t("skills.loading");
  if (mcpStore.loadState === "error")
    return mcpStore.errorText
      ? t("skills.loadFailedWithMessage", { message: mcpStore.errorText })
      : t("skills.loadFailed");
  return t("integrations.mcpReadyHint");
});

const skillPendingPath = ref("");
const canRefreshSkills = computed(
  () => Boolean(runtimeStore.serverId) && Boolean(runtimeStore.workspacePath) && skillsStore.loadState !== "loading"
);
const canOpenSkillsManager = computed(
  () => Boolean(runtimeStore.serverId) || Boolean(runtimeStore.workspacePath) || skillsStore.items.length > 0
);
const skillsStateText = computed(() => {
  if (!runtimeStore.serverId) return t("skills.disconnected");
  if (!runtimeStore.workspacePath) return t("skills.noWorkspace");
  if (skillsStore.loadState === "loading") return t("skills.loading");
  if (skillsStore.loadState === "error")
    return skillsStore.errorText
      ? t("skills.loadFailedWithMessage", { message: skillsStore.errorText })
      : t("skills.loadFailed");
  if (skillsStore.items.length === 0) {
    if (skillsStore.parseErrors.length > 0)
      return t("skills.emptyWithErrorsRaw", { count: skillsStore.parseErrors.length });
    return t("skills.empty");
  }
  return "";
});

const skillRootInput = ref("");
const currentSkillRoots = computed(() => codexSkillRootsStore.rootsForWorkspace(runtimeStore.workspacePath));
const canMutateSkillRoots = computed(
  () => Boolean(String(runtimeStore.workspacePath ?? "").trim()) && !codexSkillRootsStore.saving
);
const canAddSkillRoot = computed(() => canMutateSkillRoots.value && Boolean(skillRootInput.value.trim()));

const onAddSkillRoot = async () => {
  const root = skillRootInput.value.trim();
  if (!root) return;
  await runtime.addSkillRoot(root);
  skillRootInput.value = "";
};

const onPickSkillRoot = async () => {
  if (!canMutateSkillRoots.value) return;
  const root = await codexDesktop.workspace.select();
  if (!root) return;
  await runtime.addSkillRoot(root);
};

const onRemoveSkillRoot = (root: string) => {
  void runtime.removeSkillRoot(root);
};

const onRefreshSkills = () => {
  void runtime.refreshSkills(true);
};

const onToggleSkill = async (skill: SkillState, enabled: boolean) => {
  const path = String(skill.path ?? "").trim();
  if (!path || !skill.configurable) return;
  if (skillPendingPath.value === path) return;
  skillPendingPath.value = path;
  try {
    await runtime.toggleSkill(path, enabled);
  } finally {
    skillPendingPath.value = "";
  }
};

const onSkillToggleRequest = ({ skill, enabled }: { skill: SkillState; enabled: boolean }) => {
  void onToggleSkill(skill, enabled);
};

const canRefreshMcp = computed(() => Boolean(runtimeStore.serverId) && mcpStore.loadState !== "loading");
const canReloadMcp = computed(() => Boolean(runtimeStore.serverId) && mcpStore.loadState !== "loading");
const hasCcswitchConflict = computed(() => Boolean(codexConfigSwitcherStore.ccswitch.detected));
const ccswitchConflictText = computed(() =>
  t("integrations.ccswitchDetected", {
    path: codexConfigSwitcherStore.ccswitch.databasePath || codexConfigSwitcherStore.ccswitch.dataDir,
  })
);
const canWriteMcpConfig = computed(
  () => Boolean(runtimeStore.serverId) && !mcpConfigPending.value && !hasCcswitchConflict.value
);
const mcpStateText = computed(() => {
  if (!runtimeStore.serverId) return t("skills.disconnected");
  if (mcpStore.loadState === "loading") return t("skills.loading");
  if (mcpStore.loadState === "error")
    return mcpStore.errorText
      ? t("skills.loadFailedWithMessage", { message: mcpStore.errorText })
      : t("skills.loadFailed");
  if (mcpStore.servers.length === 0) return t("integrations.noMcpConfig");
  return "";
});

const mcpPendingId = ref("");
const mcpOauthPendingId = ref("");
const mcpConfigPending = ref(false);
const switcherPending = ref(false);
const switcherSelectedProfileId = ref("");
const switcherErrorText = ref("");
const mcpJsonText = ref("");
const mcpJsonResultText = ref("");
const mcpJsonResultIsError = ref(false);

const canManageSwitcher = computed(() => Boolean(runtimeStore.serverId) && !switcherPending.value);
const canActivateSwitcherProfile = computed(
  () => canManageSwitcher.value && Boolean(String(switcherSelectedProfileId.value ?? "").trim())
);
const switcherStatusText = computed(() => {
  if (codexConfigSwitcherStore.loadState === "loading") return t("skills.loading");
  if (codexConfigSwitcherStore.loadState === "error") return codexConfigSwitcherStore.errorText;
  const active = codexConfigSwitcherStore.activeProfile;
  const count = codexConfigSwitcherStore.profiles.length;
  const target = codexConfigSwitcherStore.codexConfigPath || "~/.codex/config.toml";
  if (!active) return t("integrations.switcherEmpty", { target });
  return t("integrations.switcherActive", { name: active.name, count, target });
});

const onImportCurrentCodexConfig = async () => {
  switcherPending.value = true;
  switcherErrorText.value = "";
  try {
    await runtime.importCurrentCodexConfigProfile();
    switcherSelectedProfileId.value = codexConfigSwitcherStore.state.activeProfileId ?? "";
  } catch (error: any) {
    switcherErrorText.value = String(error?.message ?? error ?? t("integrations.importFailed"));
  } finally {
    switcherPending.value = false;
  }
};

const onActivateSwitcherProfile = async () => {
  const id = String(switcherSelectedProfileId.value ?? "").trim();
  if (!id) return;
  switcherPending.value = true;
  switcherErrorText.value = "";
  try {
    await runtime.activateCodexConfigProfile(id);
  } catch (error: any) {
    switcherErrorText.value = String(error?.message ?? error ?? t("integrations.activateFailed"));
  } finally {
    switcherPending.value = false;
  }
};

const onDeleteMcpServer = async (serverId: string) => {
  if (hasCcswitchConflict.value) return;
  const id = normalizeCodexMcpServerId(serverId);
  if (!id) return;
  if (!window.confirm(t("integrations.confirmDeleteMcp", { id }))) return;
  mcpConfigPending.value = true;
  try {
    await runtime.deleteMcpServer(id);
  } catch {
  } finally {
    mcpConfigPending.value = false;
  }
};

const onImportMcpJson = async () => {
  mcpJsonResultText.value = "";
  mcpJsonResultIsError.value = false;
  const text = mcpJsonText.value.trim();
  if (!text) {
    mcpJsonResultText.value = t("integrations.inputJson");
    mcpJsonResultIsError.value = true;
    return;
  }
  mcpConfigPending.value = true;
  try {
    const res = await runtime.importMcpServersFromJson(text);
    mcpJsonResultIsError.value = res.imported === 0 || res.errors.length > 0;
    mcpJsonResultText.value =
      res.errors.length > 0
        ? t("integrations.importedWithErrors", { count: res.imported, errors: res.errors.join("; ") })
        : t("integrations.importedMcp", { count: res.imported });
    if (res.imported > 0) mcpJsonText.value = "";
  } catch (error: any) {
    mcpJsonResultIsError.value = true;
    mcpJsonResultText.value = String(error?.message ?? error ?? t("integrations.importFailed"));
  } finally {
    mcpConfigPending.value = false;
  }
};

const onToggleMcp = async (serverId: string, enabled: boolean) => {
  if (hasCcswitchConflict.value) return;
  if (!serverId || mcpPendingId.value === serverId) return;
  mcpPendingId.value = serverId;
  try {
    await runtime.toggleMcpEnabled(serverId, enabled);
  } finally {
    mcpPendingId.value = "";
  }
};

const onMcpEnabledChanged = (serverId: string, event: Event) => {
  const target = event.target as HTMLInputElement | null;
  const enabled = Boolean(target?.checked);
  void onToggleMcp(serverId, enabled);
};

const onMcpOAuth = async (serverId: string) => {
  if (!serverId || mcpOauthPendingId.value === serverId) return;
  mcpOauthPendingId.value = serverId;
  try {
    await runtime.startMcpOAuthLogin(serverId);
  } finally {
    mcpOauthPendingId.value = "";
  }
};

const onOpenMcpResources = (serverId: string) => {
  const id = String(serverId ?? "").trim();
  if (!id) return;
  mcpResourceStore.requestOpen(id, "resources");
  appShellStore.openSettings("integrations", { integrationsTab: "mcp" });
};

const mcpDotClass = (server: McpServerState) => {
  if (!server.enabled || server.state === "disabled") return "";
  if (server.state === "connected") return "state-connected";
  if (server.state === "connecting") return "state-connecting";
  if (server.state === "error") return "state-error";
  return "";
};

const mcpStateLabel = (server: McpServerState) => {
  if (!server.enabled) return t("integrations.stateDisabled");
  if (server.state === "connected") return t("integrations.stateConnected");
  if (server.state === "connecting") return t("integrations.stateConnecting");
  if (server.state === "error") return t("integrations.stateError");
  if (server.state === "disabled") return t("integrations.stateDisabledServer");
  return server.state ? String(server.state) : t("integrations.stateUnknown");
};

const mcpSummarySubtext = (server: McpServerState) => {
  const transport = mcpTransportLabel(server);
  if (!transport || transport === t("integrations.stateUnknown")) return "";
  return transport;
};

const mcpTransportLabel = (server: McpServerState) => {
  if (server.url) return String(server.url);
  if (server.command) return `cmd=${String(server.command)}`;
  return t("integrations.stateUnknown");
};

const mcpArgsLabel = (server: McpServerState) => {
  const args = server.args && server.args.length > 0 ? server.args : null;
  if (!args) return "";
  const raw = JSON.stringify(args);
  if (raw.length <= 180) return raw;
  return raw.slice(0, 90) + " … " + raw.slice(-70);
};

watch(
  () => open.value,
  (isOpen) => {
    if (!isOpen) return;
    if (codexConfigSwitcherStore.loadState === "idle") void runtime.refreshCodexConfigSwitcher();
    if (runtimeStore.serverId) {
      if (activeTab.value === "skills") void runtime.refreshSkills(false);
      else void runtime.refreshMcp();
    }
    void nextTick().then(() => {
      try {
        closeBtnRef.value?.focus();
      } catch {}
    });
  }
);

watch(
  () => activeTab.value,
  (tab) => {
    if (!open.value) return;
    if (tab === "skills") {
      if (runtimeStore.serverId) void runtime.refreshSkills(false);
      return;
    }
    if (codexConfigSwitcherStore.loadState === "idle") void runtime.refreshCodexConfigSwitcher();
    if (runtimeStore.serverId) void runtime.refreshMcp();
  }
);

watch(
  () => codexConfigSwitcherStore.state.activeProfileId,
  (id) => {
    switcherSelectedProfileId.value = id ?? "";
  },
  { immediate: true }
);

onMounted(() => {
  if (codexSkillRootsStore.loadState === "idle") void codexSkillRootsStore.refresh();
  if (codexConfigSwitcherStore.loadState === "idle") void runtime.refreshCodexConfigSwitcher();
  if (runtimeStore.serverId) {
    void runtime.refreshMcp();
    void runtime.refreshSkills(false);
  }
});

onBeforeUnmount(() => {
  // No-op: drawer doesn't register window listeners.
});
</script>

<style scoped>
.integrations-head-grid {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
}

.integrations-head-left {
  min-width: 0;
  justify-self: start;
}

.integrations-head-center {
  justify-self: center;
}

.integrations-head-right {
  min-width: 0;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.integrations-head-chip {
  min-width: 104px;
  justify-content: center;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.integrations-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  background: color-mix(in srgb, var(--surface-1) 72%, transparent);
}

.integrations-tab {
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: color-mix(in srgb, var(--text) 76%, transparent);
  font-size: 12px;
}

.integrations-tab.is-active {
  background: color-mix(in srgb, var(--bg-accent-soft, var(--accent-soft)) 86%, var(--surface-1));
  border-color: color-mix(in srgb, var(--border-accent, var(--accent-soft)) 58%, transparent);
  color: var(--text);
}

.integrations-tab:hover:not(.is-active) {
  background: color-mix(in srgb, var(--surface-1) 56%, transparent);
}

.integrations-panel {
  margin-bottom: 0;
  /* 清爽：抽屉内避免“面板套面板”的二次边框与阴影 */
  --panel-bg: transparent;
  --panel-border: transparent;
  --panel-shadow: none;
  padding: 0;
}

.integrations-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.integrations-toolbar-hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.integrations-mcp-tab {
  display: grid;
  gap: 12px;
}

.integrations-config-section {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
  background: color-mix(in srgb, var(--surface-1) 76%, transparent);
}

.integrations-section-head {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.integrations-section-subtitle {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.35;
}

.integrations-section-subtitle.is-error {
  color: var(--fg-danger, var(--danger));
}

.integrations-root-add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.integrations-root-list {
  display: grid;
  gap: 6px;
}

.integrations-root-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface-2) 52%, transparent);
}

.integrations-root-row > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.integrations-json-textarea,
.integrations-small-textarea {
  min-height: 88px;
  height: auto;
  padding-top: 8px;
  padding-bottom: 8px;
  resize: vertical;
  line-height: 1.4;
}

.integrations-small-textarea {
  min-height: 62px;
}

.integrations-mcp-form {
  display: grid;
  gap: 9px;
}

.integrations-checkbox-line {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
}

.integrations-form-actions,
.integrations-mcp-resource {
  display: grid;
}

.integrations-form-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.integrations-mcp-resource {
  padding: 12px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
  background: color-mix(in srgb, var(--surface-1) 76%, transparent);
}

.integrations-mcp-section-title {
  font-size: 12px;
  font-weight: 600;
  color: color-mix(in srgb, var(--text) 72%, transparent);
}

.mcp-list {
  gap: 8px;
  margin-top: 6px;
}

.mcp-details {
  padding: 10px 10px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface-1) 78%, transparent);
}

.mcp-summary {
  gap: 10px;
}

.mcp-dot {
  width: 9px;
  height: 9px;
}

.mcp-title {
  font-weight: 650;
}

.mcp-title-wrap {
  min-width: 0;
  flex: 1 1 auto;
  display: grid;
  gap: 2px;
}

.mcp-subtitle {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  transition: transform 0.15s ease;
}

.chevron.open {
  transform: rotate(90deg);
}

.mcp-details.is-open .mcp-summary .chevron {
  transform: rotate(90deg);
}

.mcp-body {
  gap: 10px;
}

.mcp-meta {
  display: grid;
  gap: 8px;
}

.mcp-meta-row {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 10px;
  align-items: start;
  min-width: 0;
}

.mcp-meta-key {
  font-size: 12px;
  line-height: 1.25;
}

.mcp-meta-val {
  font-size: 12px;
  overflow-wrap: anywhere;
  color: color-mix(in srgb, var(--text) 76%, transparent);
}

.mcp-message {
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: color-mix(in srgb, var(--surface-1) 78%, transparent);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  color: color-mix(in srgb, var(--text) 76%, transparent);
}

.mcp-message.is-error {
  border-color: color-mix(in srgb, var(--danger) 32%, var(--border));
  background: color-mix(in srgb, var(--bg-danger-soft) 42%, var(--surface-1));
}

.btn-mini.danger {
  border-color: var(--border-danger);
  color: var(--fg-danger);
  background: var(--bg-danger-soft);
}
</style>
