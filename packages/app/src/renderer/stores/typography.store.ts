import { defineStore } from "./zustandCompat";
import { getCachedUserLocalSettings, patchUserLocalSettings } from "../domain/localSettings";
import {
  DEFAULT_UI_FONT_FAMILY_PRESET,
  DEFAULT_UI_FONT_SIZE_PRESET,
  type UiFontFamilyPreset,
  type UiFontSizePreset,
} from "@codenexus/shared/localSettings";

export const UI_FONT_FAMILY_PRESET_OPTIONS: Array<{ value: UiFontFamilyPreset; label: string }> = [
  { value: "alibaba-puhuiti", label: "globalConfig.fontFamilyAlibaba" },
  { value: "source-han-sans-sc", label: "globalConfig.fontFamilySourceHan" },
];

export const UI_FONT_SIZE_PRESET_OPTIONS: Array<{ value: UiFontSizePreset; label: string }> = [
  { value: "small", label: "globalConfig.fontSizeSmall" },
  { value: "medium", label: "globalConfig.fontSizeMedium" },
  { value: "large", label: "globalConfig.fontSizeLarge" },
];

function normalizeFontFamilyPreset(value: unknown): UiFontFamilyPreset {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "source-han-sans-sc") return "source-han-sans-sc";
  if (raw === "alibaba-puhuiti") return "alibaba-puhuiti";
  return DEFAULT_UI_FONT_FAMILY_PRESET;
}

function normalizeFontSizePreset(value: unknown): UiFontSizePreset {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "small") return "small";
  if (raw === "large") return "large";
  return DEFAULT_UI_FONT_SIZE_PRESET;
}

function applyFontFamilyToDocument(preset: UiFontFamilyPreset): void {
  try {
    document.documentElement.dataset.fontFamily = preset;
  } catch {}
}

export const useTypographyStore = defineStore("typography", {
  state: () => ({
    fontFamilyPreset: DEFAULT_UI_FONT_FAMILY_PRESET as UiFontFamilyPreset,
    fontSizePreset: DEFAULT_UI_FONT_SIZE_PRESET as UiFontSizePreset,
    ready: false,
  }),
  actions: {
    initTypography() {
      const cached = getCachedUserLocalSettings();
      this.fontFamilyPreset = normalizeFontFamilyPreset(cached.settings.ui.fontFamilyPreset);
      this.fontSizePreset = normalizeFontSizePreset(cached.settings.ui.fontSizePreset);
      this.ready = true;
      applyFontFamilyToDocument(this.fontFamilyPreset);
      if (!cached.exists) {
        void patchUserLocalSettings({
          ui: {
            fontFamilyPreset: this.fontFamilyPreset,
            fontSizePreset: this.fontSizePreset,
          },
        });
      }
    },
    setFontFamilyPreset(next: unknown, opts?: { save?: boolean }) {
      const shouldSave = opts?.save ?? true;
      const normalized = normalizeFontFamilyPreset(next);
      this.fontFamilyPreset = normalized;
      applyFontFamilyToDocument(this.fontFamilyPreset);
      if (!shouldSave) return;
      void patchUserLocalSettings({ ui: { fontFamilyPreset: this.fontFamilyPreset } });
    },
    setFontSizePreset(next: unknown, opts?: { save?: boolean }) {
      const shouldSave = opts?.save ?? true;
      const normalized = normalizeFontSizePreset(next);
      this.fontSizePreset = normalized;
      if (!shouldSave) return;
      void patchUserLocalSettings({ ui: { fontSizePreset: this.fontSizePreset } });
    },
  },
});
