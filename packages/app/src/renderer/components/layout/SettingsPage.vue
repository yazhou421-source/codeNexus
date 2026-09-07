<template>
  <section class="settings-page" :aria-label="t('settings.pageAria')">
    <div class="settings-workspace">
      <aside class="settings-sidebar app-scrollbar" :aria-label="t('settings.sidebarAria')">
        <button class="settings-back" type="button" @click="appShellStore.closeSettings()">
          <ArrowLeft aria-hidden="true" />{{ t("common.back") }}
        </button>
        <nav
          class="settings-nav"
          @keydown="onNavKeydown"
          role="tablist"
          aria-orientation="vertical"
          :aria-label="t('settings.tabsAria')"
        >
          <section v-for="group in tabGroups" :key="group.label" class="settings-nav-group">
            <div class="settings-nav-section">{{ group.label }}</div>
            <button
              v-for="tab in group.items"
              :key="tab.key"
              class="settings-nav-item"
              :class="{ 'is-active': activeNavTab === tab.key }"
              type="button"
              role="tab"
              :aria-selected="activeNavTab === tab.key ? 'true' : 'false'"
              :tabindex="activeNavTab === tab.key ? 0 : -1"
              @click="selectTab(tab.key)"
            >
              <component :is="tab.icon" class="settings-nav-icon" aria-hidden="true" />
              <span class="settings-nav-copy">
                <span class="settings-nav-label">{{ tab.label }}</span>
                <span class="settings-nav-desc">{{ tab.desc }}</span>
              </span>
            </button>
          </section>
        </nav>
      </aside>

      <div class="settings-scroll app-scrollbar">
        <div class="settings-stage">
          <div class="settings-tab-content" :data-tab="activeTab">
            <GlobalConfigDrawer
              v-if="['global', 'appearance', 'defaults', 'permissions'].includes(activeTab)"
              mode="settings"
              :section="configSection"
            />
            <SettingsModelProvidersTab v-else-if="activeTab === 'models'" />
            <CodexProfilesSettingsTab v-else-if="activeTab === 'profiles'" />
            <SettingsSoundTab v-else-if="activeTab === 'sound'" />
            <component :is="activeFeatureSettingsComponent" v-else-if="activeFeatureSettingsComponent" />
            <SettingsUpdateTab v-else-if="activeTab === 'update'" />
            <SettingsAdvancedTab v-else-if="activeTab === 'advanced'" />
            <EnvSetupDrawer v-else-if="activeTab === 'env'" mode="settings" />
            <IntegrationsDrawer v-else-if="['integrations', 'skills', 'mcp'].includes(activeTab)" mode="settings" />
            <GlobalConfigDrawer v-else mode="settings" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ArrowLeft,
  Bell,
  Bot,
  Cpu,
  Download,
  FlaskConical,
  Image,
  PlugZap,
  Settings2,
  SlidersHorizontal,
  Workflow,
} from "lucide-vue-next";
import { useAppShellStore, type SettingsTab } from "../../stores/appShell.store";
import { FEATURE_SETTINGS_TABS, getFeatureSettingsByTab } from "../../features/registry";
import GlobalConfigDrawer from "./overlays/GlobalConfigDrawer.vue";
import EnvSetupDrawer from "./overlays/EnvSetupDrawer.vue";
import IntegrationsDrawer from "./overlays/IntegrationsDrawer.vue";
import SettingsSoundTab from "./settings/SettingsSoundTab.vue";
import SettingsUpdateTab from "./settings/SettingsUpdateTab.vue";
import CodexProfilesSettingsTab from "./settings/CodexProfilesSettingsTab.vue";
import SettingsModelProvidersTab from "./settings/SettingsModelProvidersTab.vue";
import SettingsAdvancedTab from "./settings/SettingsAdvancedTab.vue";

const appShellStore = useAppShellStore();
const { t, locale } = useI18n();
const activeTab = computed(() => appShellStore.settingsActiveTab);
const configSection = computed(() =>
  activeTab.value === "defaults" ? "defaults" : activeTab.value === "permissions" ? "permissions" : "appearance"
);
const settingsFeatureIconByName = {
  image: Image,
  workflow: Workflow,
} as const;
const activeFeatureSettingsComponent = computed(() => getFeatureSettingsByTab(activeTab.value)?.component ?? null);
const zh = computed(() => locale.value.startsWith("zh"));
const activeNavTab = computed(() =>
  activeTab.value === "global"
    ? "appearance"
    : ["integrations", "skills", "mcp"].includes(activeTab.value)
      ? appShellStore.settingsIntegrationsTab
      : activeTab.value
);
function selectTab(tab: SettingsTab) {
  if (tab === "skills" || tab === "mcp") appShellStore.setSettingsIntegrationsTab(tab);
  appShellStore.setSettingsTab(tab);
}
const tabGroups = computed(() => [
  {
    label: zh.value ? "通用" : "General",
    items: [
      { key: "appearance" as const, label: zh.value ? "外观与语言" : "Appearance", desc: "", icon: SlidersHorizontal },
    ],
  },
  {
    label: "AI",
    items: [
      { key: "models" as const, label: zh.value ? "服务与账户" : "Providers & Account", desc: "", icon: Cpu },
      { key: "defaults" as const, label: zh.value ? "默认模型" : "Default Model", desc: "", icon: Bot },
      { key: "permissions" as const, label: zh.value ? "权限" : "Permissions", desc: "", icon: Settings2 },
    ],
  },
  {
    label: zh.value ? "工具" : "Tools",
    items: [
      { key: "skills" as const, label: "Skills", desc: "", icon: Bot },
      { key: "mcp" as const, label: "MCP", desc: "", icon: PlugZap },
      ...FEATURE_SETTINGS_TABS.map((tab) => ({
        key: tab.tab,
        label: t(tab.labelKey),
        desc: t(tab.descKey),
        icon: settingsFeatureIconByName[tab.icon],
      })),
    ],
  },
  {
    label: zh.value ? "系统" : "System",
    items: [
      { key: "env" as const, label: t("settings.tabs.env"), desc: "", icon: Settings2 },
      { key: "sound" as const, label: t("settings.tabs.sound"), desc: "", icon: Bell },
      { key: "update" as const, label: t("settings.tabs.update"), desc: "", icon: Download },
    ],
  },
  {
    label: zh.value ? "高级" : "Advanced",
    items: [
      { key: "profiles" as const, label: zh.value ? "连接配置文件" : "Connection Profiles", desc: "", icon: PlugZap },
      { key: "advanced" as const, label: t("settings.tabs.advanced"), desc: "", icon: FlaskConical },
    ],
  },
]);

function onNavKeydown(event: KeyboardEvent) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
  buttons[next]?.click();
}

watch(
  () => appShellStore.settingsOpen,
  (open) => {
    if (!open) return;
    // Settings 页进入时保持 Integrations 子 tab 同步到 store，确保从 MCP 跳转能落地。
    if (activeTab.value === "integrations") {
      appShellStore.setSettingsIntegrationsTab(appShellStore.settingsIntegrationsTab);
    }
  }
);
</script>
