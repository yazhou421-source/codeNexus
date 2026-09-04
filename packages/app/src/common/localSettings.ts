import {
  DEFAULT_LOCAL_FLOWCHART_AI_SETTINGS,
  normalizeFlowchartAiSettings,
} from "@codenexus/feature-flowchart/settings";
import {
  DEFAULT_LOCAL_IMAGE_GENERATION_SETTINGS,
  normalizeImageGenerationSettings,
} from "@codenexus/feature-imagegen/settings";
import {
  DEFAULT_USER_LOCAL_SETTINGS as SHARED_DEFAULT_USER_LOCAL_SETTINGS,
  mergeUserLocalSettings as mergeSharedUserLocalSettings,
  normalizeUserLocalSettings as normalizeSharedUserLocalSettings,
  migrateUserLocalSettingsForOnboarding,
  type UserLocalSettings,
  type UserLocalSettingsPatch,
} from "@codenexus/shared/localSettings";

export type { UserLocalSettings, UserLocalSettingsPatch };
export { migrateUserLocalSettingsForOnboarding };

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function normalizeUserLocalSettings(value: unknown): UserLocalSettings {
  const root = toRecord(value);
  const settings = normalizeSharedUserLocalSettings(value);
  return {
    ...settings,
    imageGeneration: normalizeImageGenerationSettings(root?.imageGeneration),
    flowchartAi: normalizeFlowchartAiSettings(root?.flowchartAi),
  };
}

export const DEFAULT_USER_LOCAL_SETTINGS: UserLocalSettings = normalizeUserLocalSettings({
  ...SHARED_DEFAULT_USER_LOCAL_SETTINGS,
  imageGeneration: DEFAULT_LOCAL_IMAGE_GENERATION_SETTINGS,
  flowchartAi: DEFAULT_LOCAL_FLOWCHART_AI_SETTINGS,
});

export function mergeUserLocalSettings(
  base: unknown,
  patch: UserLocalSettingsPatch | null | undefined
): UserLocalSettings {
  return normalizeUserLocalSettings(mergeSharedUserLocalSettings(base, patch));
}
