import { Bell, Bot, Download, Image, PlugZap, Settings2, SlidersHorizontal, Workflow } from "lucide-react";
import { useEffect } from "react";
import { useAppShellStore, type SettingsTab } from "../../stores/appShell.store";
import { FEATURE_SETTINGS_TABS, getFeatureSettingsByTab } from "../../features/registry";
import { translate } from "../../i18n/translate";
import GlobalConfigDrawer from "./overlays/GlobalConfigDrawer";
import EnvSetupDrawer from "./overlays/EnvSetupDrawer";
import IntegrationsDrawer from "./overlays/IntegrationsDrawer";
import CodexProfilesSettingsTab from "./settings/CodexProfilesSettingsTab";
import SettingsSoundTab from "./settings/SettingsSoundTab";
import SettingsUpdateTab from "./settings/SettingsUpdateTab";

export default function SettingsPage() {
  const appShellStore = useAppShellStore();
  const activeTab = appShellStore.settingsActiveTab;
  const featureSettings = getFeatureSettingsByTab(activeTab);
  const FeatureSettingsComponent = featureSettings?.component ?? null;
  const featureIconByName = { image: Image, workflow: Workflow } as const;
  const tabGroups = [
    {
      label: translate("settings.groups.basics"),
      items: [
        { key: "global" as const, label: translate("settings.tabs.global"), desc: translate("settings.tabs.globalDesc"), icon: SlidersHorizontal },
        { key: "profiles" as const, label: translate("settings.tabs.profiles"), desc: translate("settings.tabs.profilesDesc"), icon: Bot },
      ],
    },
    {
      label: translate("settings.groups.extensions"),
      items: [
        { key: "integrations" as const, label: translate("settings.tabs.integrations"), desc: translate("settings.tabs.integrationsDesc"), icon: PlugZap },
        ...FEATURE_SETTINGS_TABS.map((tab) => ({
          key: tab.tab,
          label: translate(tab.labelKey),
          desc: translate(tab.descKey),
          icon: featureIconByName[tab.icon],
        })),
      ],
    },
    {
      label: translate("settings.groups.runtime"),
      items: [
        { key: "sound" as const, label: translate("settings.tabs.sound"), desc: translate("settings.tabs.soundDesc"), icon: Bell },
        { key: "update" as const, label: translate("settings.tabs.update"), desc: translate("settings.tabs.updateDesc"), icon: Download },
        { key: "env" as const, label: translate("settings.tabs.env"), desc: translate("settings.tabs.envDesc"), icon: Settings2 },
      ],
    },
  ];

  useEffect(() => {
    if (appShellStore.settingsOpen && activeTab === "integrations") {
      appShellStore.setSettingsIntegrationsTab(appShellStore.settingsIntegrationsTab);
    }
  }, [appShellStore.settingsOpen, activeTab]);

  return (
    <section className="settings-page" aria-label={translate("settings.pageAria")}>
      <div className="settings-workspace">
      <aside className="settings-sidebar app-scrollbar" aria-label={translate("settings.sidebarAria")}>
        <nav className="settings-nav" role="tablist" aria-label={translate("settings.tabsAria")}>
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
