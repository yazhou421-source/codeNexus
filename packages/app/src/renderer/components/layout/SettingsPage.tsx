import { Bell, Bot, Download, Image, PlugZap, Settings2, SlidersHorizontal, Workflow } from "lucide-react";
import { useEffect } from "react";
import { useAppShellStore, type SettingsTab } from "../../stores/appShell.store";
import { FEATURE_SETTINGS_TABS, getFeatureSettingsByTab } from "../../features/registry";
import GlobalConfigDrawer from "./overlays/GlobalConfigDrawer";
import EnvSetupDrawer from "./overlays/EnvSetupDrawer";
import IntegrationsDrawer from "./overlays/IntegrationsDrawer";
import CodexProfilesSettingsTab from "./settings/CodexProfilesSettingsTab";
import SettingsSoundTab from "./settings/SettingsSoundTab";
import SettingsUpdateTab from "./settings/SettingsUpdateTab";

const FEATURE_TAB_TEXT: Record<string, string> = {
  "settings.tabs.image": "图片生成",
  "settings.tabs.imageDesc": "OpenAI Images API 与本地工作台",
  "settings.tabs.flowchart": "流程图 AI",
  "settings.tabs.flowchartDesc": "Chat Completions 生成与修改图模型",
};
const featureTabText = (key: string): string => FEATURE_TAB_TEXT[key] ?? key;

export default function SettingsPage() {
  const appShellStore = useAppShellStore();
  const activeTab = appShellStore.settingsActiveTab;
  const featureSettings = getFeatureSettingsByTab(activeTab);
  const FeatureSettingsComponent = featureSettings?.component ?? null;
  const featureIconByName = { image: Image, workflow: Workflow } as const;
  const tabGroups = [
    {
      label: "基础配置",
      items: [
        { key: "global" as const, label: "通用", desc: "全局配置与界面偏好", icon: SlidersHorizontal },
        { key: "profiles" as const, label: "模型配置", desc: "Provider、模型与 API Key", icon: Bot },
      ],
    },
    {
      label: "能力扩展",
      items: [
        { key: "integrations" as const, label: "集成与工具", desc: "Skills、MCP 与扩展能力", icon: PlugZap },
        ...FEATURE_SETTINGS_TABS.map((tab) => ({
          key: tab.tab,
          label: featureTabText(tab.labelKey),
          desc: featureTabText(tab.descKey),
          icon: featureIconByName[tab.icon],
        })),
      ],
    },
    {
      label: "运行状态",
      items: [
        { key: "sound" as const, label: "提示音", desc: "线程结束提醒与音量", icon: Bell },
        { key: "update" as const, label: "应用更新", desc: "版本检查、下载与安装", icon: Download },
        { key: "env" as const, label: "环境检测", desc: "本机依赖与运行环境", icon: Settings2 },
      ],
    },
  ];

  useEffect(() => {
    if (appShellStore.settingsOpen && activeTab === "integrations") {
      appShellStore.setSettingsIntegrationsTab(appShellStore.settingsIntegrationsTab);
    }
  }, [appShellStore.settingsOpen, activeTab]);

  return (
    <section className="settings-page" aria-label="设置页">
      <div className="settings-workspace">
      <aside className="settings-sidebar app-scrollbar" aria-label="设置导航">
        <nav className="settings-nav" role="tablist" aria-label="设置选项卡">
          {tabGroups.map((group) => (
            <section key={group.label} className="settings-nav-group">
              <div className="settings-nav-section">{group.label}</div>
              {group.items.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    className={`settings-nav-item${active ? " is-active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => appShellStore.setSettingsTab(tab.key as SettingsTab)}
                  >
                    <Icon className="settings-nav-icon" aria-hidden="true" />
                    <span className="settings-nav-copy">
                      <span className="settings-nav-label">{tab.label}</span>
                      <span className="settings-nav-desc">{tab.desc}</span>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </nav>
      </aside>
      <div className="settings-scroll app-scrollbar">
        <div className="settings-stage">
          <div className="settings-tab-content" data-tab={activeTab}>
            {activeTab === "global" ? <GlobalConfigDrawer mode="settings" /> : null}
            {activeTab === "profiles" ? <CodexProfilesSettingsTab /> : null}
            {activeTab === "sound" ? <SettingsSoundTab /> : null}
            {FeatureSettingsComponent ? <FeatureSettingsComponent /> : null}
            {activeTab === "update" ? <SettingsUpdateTab /> : null}
            {activeTab === "env" ? <EnvSetupDrawer mode="settings" /> : null}
            {activeTab === "integrations" ? <IntegrationsDrawer mode="settings" /> : null}
            {!FeatureSettingsComponent &&
            activeTab !== "global" &&
            activeTab !== "profiles" &&
            activeTab !== "sound" &&
            activeTab !== "update" &&
            activeTab !== "env" &&
            activeTab !== "integrations" ? (
              <GlobalConfigDrawer mode="settings" />
            ) : null}
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}
