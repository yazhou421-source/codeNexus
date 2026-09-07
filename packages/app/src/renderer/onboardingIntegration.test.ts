import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const rendererRoot = new URL("./", import.meta.url);

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, rendererRoot), "utf8");
}

describe("onboarding product entry points", () => {
  it("shows onboarding instead of the legacy runtime mode chooser", async () => {
    const app = await source("App.vue");
    expect(app).toContain("<OnboardingFlow");
    expect(app).not.toContain("RuntimeModeChooser");
  });

  it("removes the runtime mode switch from the ordinary bottom bar", async () => {
    const bottomBar = await source("components/layout/BottomBar.vue");
    const customWorkbench = await source("components/custom/CustomWorkbench.vue");
    expect(bottomBar).not.toContain("openModeChooser");
    expect(bottomBar).not.toContain("bottom-bar__mode-switch");
    expect(customWorkbench).not.toContain("openModeChooser");
    expect(customWorkbench).toContain("openSettings('advanced')");
  });

  it("keeps Custom Provider mode behind the Advanced experimental settings entry", async () => {
    const settingsPage = await source("components/layout/SettingsPage.vue");
    const advanced = await source("components/layout/settings/SettingsAdvancedTab.vue");
    expect(settingsPage).toContain("activeTab === 'advanced'");
    expect(advanced).toContain("advancedSettings.experimental");
    expect(advanced).toContain("appShellStore.setRuntimeMode('custom')");
  });
});
