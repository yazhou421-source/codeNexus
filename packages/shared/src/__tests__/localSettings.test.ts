import { describe, it, expect } from "vitest";
import {
  normalizeUserLocalSettings,
  mergeUserLocalSettings,
  normalizeUiLanguage,
  migrateUserLocalSettingsForOnboarding,
  resolveUiFontSizeZoomFactor,
  DEFAULT_USER_LOCAL_SETTINGS,
} from "../localSettings";

describe("localSettings", () => {
  describe("normalizeUiLanguage", () => {
    it("normalizes en variants to en-US", () => {
      expect(normalizeUiLanguage("en")).toBe("en-US");
      expect(normalizeUiLanguage("en-US")).toBe("en-US");
      expect(normalizeUiLanguage("en-us")).toBe("en-US");
      expect(normalizeUiLanguage("EN")).toBe("en-US");
    });

    it("normalizes zh variants to zh-CN", () => {
      expect(normalizeUiLanguage("zh")).toBe("zh-CN");
      expect(normalizeUiLanguage("zh-CN")).toBe("zh-CN");
      expect(normalizeUiLanguage("zh-cn")).toBe("zh-CN");
      expect(normalizeUiLanguage("zh-Hans")).toBe("zh-CN");
      expect(normalizeUiLanguage("zh_cn")).toBe("zh-CN");
      expect(normalizeUiLanguage("zh-Hans-CN")).toBe("zh-CN");
    });

    it("falls back to default for unknown locales", () => {
      expect(normalizeUiLanguage("fr")).toBe("zh-CN");
      expect(normalizeUiLanguage("")).toBe("zh-CN");
      expect(normalizeUiLanguage(null)).toBe("zh-CN");
      expect(normalizeUiLanguage(undefined)).toBe("zh-CN");
    });
  });

  describe("resolveUiFontSizeZoomFactor", () => {
    it("returns a positive number for valid presets", () => {
      expect(resolveUiFontSizeZoomFactor("small")).toBeGreaterThan(0);
      expect(resolveUiFontSizeZoomFactor("medium")).toBeGreaterThan(0);
      expect(resolveUiFontSizeZoomFactor("large")).toBeGreaterThan(0);
    });

    it("medium is between small and large", () => {
      const small = resolveUiFontSizeZoomFactor("small");
      const medium = resolveUiFontSizeZoomFactor("medium");
      const large = resolveUiFontSizeZoomFactor("large");
      expect(medium).toBeGreaterThan(small);
      expect(large).toBeGreaterThan(medium);
    });
  });

  describe("normalizeUserLocalSettings", () => {
    it("returns defaults when input is null/undefined", () => {
      expect(normalizeUserLocalSettings(null)).toEqual(
        DEFAULT_USER_LOCAL_SETTINGS,
      );
      expect(normalizeUserLocalSettings(undefined)).toEqual(
        DEFAULT_USER_LOCAL_SETTINGS,
      );
    });

    it("returns defaults when input is empty object", () => {
      expect(normalizeUserLocalSettings({})).toEqual(
        DEFAULT_USER_LOCAL_SETTINGS,
      );
    });

    it("preserves valid settings", () => {
      const result = normalizeUserLocalSettings({
        ui: { language: "en-US", mainView: "image", leftSidebarWidthPx: 400 },
      });
      expect(result.ui.language).toBe("en-US");
      expect(result.ui.mainView).toBe("image");
      expect(result.ui.leftSidebarWidthPx).toBe(400);
    });

    it("clamps numeric values into valid ranges", () => {
      const result = normalizeUserLocalSettings({
        notification: { soundVolumePercent: 200 },
      });
      expect(result.notification.soundVolumePercent).toBe(100);

      const result2 = normalizeUserLocalSettings({
        notification: { soundVolumePercent: -50 },
      });
      expect(result2.notification.soundVolumePercent).toBe(0);
    });

    it("rejects invalid baseUrl (missing scheme)", () => {
      const result = normalizeUserLocalSettings({
        imageGeneration: { baseUrl: "not-a-url" },
      });
      expect(result.imageGeneration.baseUrl).toBeNull();
    });

    it("accepts valid baseUrl with http/https", () => {
      const result = normalizeUserLocalSettings({
        imageGeneration: { baseUrl: "https://api.example.com/v1" },
      });
      expect(result.imageGeneration.baseUrl).toBe("https://api.example.com/v1");
    });

    it("strips trailing slashes from baseUrl", () => {
      const result = normalizeUserLocalSettings({
        imageGeneration: { baseUrl: "https://api.example.com/v1///" },
      });
      expect(result.imageGeneration.baseUrl).toBe("https://api.example.com/v1");
    });

    it("rejects invalid mainView values", () => {
      const result = normalizeUserLocalSettings({
        ui: { mainView: "invalid" },
      });
      expect(result.ui.mainView).toBe("chat");
    });

    it("handles non-object input gracefully", () => {
      expect(normalizeUserLocalSettings("string")).toEqual(
        DEFAULT_USER_LOCAL_SETTINGS,
      );
      expect(normalizeUserLocalSettings(42)).toEqual(
        DEFAULT_USER_LOCAL_SETTINGS,
      );
      expect(normalizeUserLocalSettings([])).toEqual(
        DEFAULT_USER_LOCAL_SETTINGS,
      );
    });
  });

  describe("mergeUserLocalSettings", () => {
    it("returns defaults when base and patch are null", () => {
      const result = mergeUserLocalSettings(null, null);
      expect(result).toEqual(DEFAULT_USER_LOCAL_SETTINGS);
    });

    it("merges ui patch into base", () => {
      const base = { ui: { language: "en-US" } };
      const patch = { ui: { mainView: "flowchart" as const } };
      const result = mergeUserLocalSettings(base, patch);
      expect(result.ui.language).toBe("en-US");
      expect(result.ui.mainView).toBe("flowchart");
    });

    it("merges imageGeneration patch", () => {
      const base = { imageGeneration: { enabled: true } };
      const patch = { imageGeneration: { model: "dall-e-3" } };
      const result = mergeUserLocalSettings(base, patch);
      expect(result.imageGeneration.enabled).toBe(true);
      expect(result.imageGeneration.model).toBe("dall-e-3");
    });

    it("setting apiKey to null clears it", () => {
      const base = { imageGeneration: { apiKey: "sk-test" } };
      const patch = { imageGeneration: { apiKey: null } };
      const result = mergeUserLocalSettings(base, patch);
      expect(result.imageGeneration.apiKey).toBeNull();
    });

    it("does not modify unrelated fields", () => {
      const base = {
        ui: { theme: "dark", language: "en-US" },
        notification: { soundVolumePercent: 80 },
      };
      const patch = { ui: { theme: "pink" } };
      const result = mergeUserLocalSettings(base, patch);
      expect(result.ui.theme).toBe("pink");
      expect(result.notification.soundVolumePercent).toBe(80);
    });
  });

  describe("runtimeMode", () => {
    it("defaults new users to the Codex Agent mode", () => {
      expect(normalizeUserLocalSettings({}).ui.runtimeMode).toBe("codex");
    });

    it("accepts codex and custom; rejects anything else", () => {
      expect(
        normalizeUserLocalSettings({ ui: { runtimeMode: "codex" } }).ui
          .runtimeMode,
      ).toBe("codex");
      expect(
        normalizeUserLocalSettings({ ui: { runtimeMode: "custom" } }).ui
          .runtimeMode,
      ).toBe("custom");
      expect(
        normalizeUserLocalSettings({ ui: { runtimeMode: "nope" } }).ui
          .runtimeMode,
      ).toBe("codex");
    });

    it("can be set and null falls back to the product default", () => {
      const chosen = mergeUserLocalSettings(
        {},
        { ui: { runtimeMode: "custom" } },
      );
      expect(chosen.ui.runtimeMode).toBe("custom");
      const cleared = mergeUserLocalSettings(chosen, {
        ui: { runtimeMode: null },
      });
      expect(cleared.ui.runtimeMode).toBe("codex");
    });
  });

  describe("onboarding", () => {
    it("starts a fresh profile at the welcome step", () => {
      expect(normalizeUserLocalSettings({}).onboarding).toEqual({
        version: 1,
        step: "welcome",
        completedAt: null,
        selectedService: null,
        projectSelected: false,
        projectPath: null,
      });
    });

    it("persists an interrupted step without storing credentials", () => {
      const settings = mergeUserLocalSettings(
        {},
        {
          onboarding: { step: "account", selectedService: "deepseek" },
        },
      );
      expect(settings.onboarding).toMatchObject({
        step: "account",
        selectedService: "deepseek",
      });
      expect(JSON.stringify(settings.onboarding)).not.toMatch(
        /key|token|secret/i,
      );
    });

    it("migrates an existing settings profile once and preserves custom mode", () => {
      const first = migrateUserLocalSettingsForOnboarding(
        {
          ui: { runtimeMode: "custom" },
          customProviders: { workspaceRoot: "/project" },
        },
        {
          settingsFileExists: true,
          legacyUserDataExists: true,
          now: "2026-09-04T00:00:00.000Z",
        },
      );
      expect(first.migrated).toBe(true);
      expect(first.settings.ui.runtimeMode).toBe("custom");
      expect(first.settings.onboarding).toMatchObject({
        step: "complete",
        completedAt: "2026-09-04T00:00:00.000Z",
        projectSelected: true,
        projectPath: "/project",
      });

      const second = migrateUserLocalSettingsForOnboarding(first.settings, {
        settingsFileExists: true,
        legacyUserDataExists: true,
        now: "2027-01-01T00:00:00.000Z",
      });
      expect(second.migrated).toBe(false);
      expect(second.settings.onboarding.completedAt).toBe(
        "2026-09-04T00:00:00.000Z",
      );
    });

    it("does not skip onboarding for a genuinely fresh profile", () => {
      const result = migrateUserLocalSettingsForOnboarding(
        {},
        {
          settingsFileExists: false,
          legacyUserDataExists: false,
        },
      );
      expect(result.migrated).toBe(false);
      expect(result.settings.onboarding.completedAt).toBeNull();
    });

    it("preserves a future onboarding version for forward-compatible state", () => {
      const settings = normalizeUserLocalSettings({
        onboarding: { version: 2, step: "project", selectedService: "qwen" },
      });
      expect(settings.onboarding).toMatchObject({
        version: 2,
        step: "project",
        selectedService: "qwen",
      });
      expect(
        mergeUserLocalSettings(settings, {
          onboarding: { projectSelected: true },
        }).onboarding.version,
      ).toBe(2);
    });
  });

  describe("customProviders", () => {
    it("defaults to empty with no active provider", () => {
      expect(normalizeUserLocalSettings({}).customProviders).toEqual({
        activeProviderId: null,
        providers: [],
        workspaceRoot: null,
      });
    });

    it("keeps valid providers, drops ones without id, and dedupes by id (last wins)", () => {
      const result = normalizeUserLocalSettings({
        customProviders: {
          providers: [
            {
              id: "a",
              kind: "openai-compatible",
              name: "A",
              baseUrl: "https://a.example.com/v1",
              apiKey: "k",
              model: "m",
            },
            { kind: "openai-compatible", name: "no-id" },
            {
              id: "a",
              kind: "anthropic",
              name: "A2",
              baseUrl: "https://a2.example.com",
              apiKey: "k2",
              model: "m2",
            },
          ],
        },
      });
      expect(result.customProviders.providers).toHaveLength(1);
      expect(result.customProviders.providers[0].id).toBe("a");
      expect(result.customProviders.providers[0].kind).toBe("anthropic");
    });

    it("rejects invalid provider baseUrl (missing scheme)", () => {
      const result = normalizeUserLocalSettings({
        customProviders: { providers: [{ id: "a", baseUrl: "not-a-url" }] },
      });
      expect(result.customProviders.providers[0].baseUrl).toBeNull();
    });

    it("nulls activeProviderId when it points to a missing provider, keeps it when present", () => {
      const missing = normalizeUserLocalSettings({
        customProviders: { activeProviderId: "ghost", providers: [] },
      });
      expect(missing.customProviders.activeProviderId).toBeNull();

      const present = normalizeUserLocalSettings({
        customProviders: {
          activeProviderId: "a",
          providers: [
            {
              id: "a",
              kind: "openai-compatible",
              name: "A",
              baseUrl: "https://a.example.com",
              apiKey: "k",
              model: "m",
            },
          ],
        },
      });
      expect(present.customProviders.activeProviderId).toBe("a");
    });

    it("merge replaces providers and active id", () => {
      const result = mergeUserLocalSettings(
        {},
        {
          customProviders: {
            activeProviderId: "a",
            providers: [
              {
                id: "a",
                kind: "openai-compatible",
                name: "A",
                baseUrl: "https://a.example.com",
                apiKey: "k",
                model: "m",
              },
            ],
          },
        },
      );
      expect(result.customProviders.activeProviderId).toBe("a");
      expect(result.customProviders.providers).toHaveLength(1);
    });

    it("normalizes workspaceRoot (trims; blank → null) and merges it", () => {
      expect(
        normalizeUserLocalSettings({
          customProviders: { workspaceRoot: "  /tmp/ws  " },
        }).customProviders.workspaceRoot,
      ).toBe("/tmp/ws");
      expect(
        normalizeUserLocalSettings({
          customProviders: { workspaceRoot: "   " },
        }).customProviders.workspaceRoot,
      ).toBeNull();
      expect(
        normalizeUserLocalSettings({}).customProviders.workspaceRoot,
      ).toBeNull();

      const merged = mergeUserLocalSettings(
        {},
        { customProviders: { workspaceRoot: "/work" } },
      );
      expect(merged.customProviders.workspaceRoot).toBe("/work");
    });

    it("normalizes provider.thinking (defaults false, keeps true)", () => {
      const off = normalizeUserLocalSettings({
        customProviders: { providers: [{ id: "a", kind: "anthropic" }] },
      });
      expect(off.customProviders.providers[0].thinking).toBe(false);

      const on = normalizeUserLocalSettings({
        customProviders: {
          providers: [{ id: "a", kind: "anthropic", thinking: true }],
        },
      });
      expect(on.customProviders.providers[0].thinking).toBe(true);
    });
  });
});
