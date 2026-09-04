import type { App } from "electron";
import { dirname, join, resolve } from "node:path";

export const PRODUCT_NAME = "Calmnova Code";
export const PRODUCT_BRAND = "Calmnova";
export const PRODUCT_APP_ID = "com.calmnova.code";
export const LEGACY_PRODUCT_APP_ID = "com.codenexus.desktop";
export const PRODUCT_SUBTITLE_EN = "AI Coding Workspace";
export const PRODUCT_SUBTITLE_ZH = "AI 编程工作台";
export const LEGACY_PRODUCT_NAME = "CodeNexus";

export type ProductUserDataPaths = {
  legacyPath: string;
  currentPath: string;
  appDataPath: string;
  explicitUserDataPath: boolean;
};

export function userDataPathFromArgv(argv: readonly string[]): string | null {
  const prefix = "--user-data-dir=";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length).trim();
      return value ? resolve(value) : null;
    }
    if (arg === "--user-data-dir") {
      const value = argv[index + 1]?.trim();
      return value ? resolve(value) : null;
    }
  }
  return null;
}

export function resolveProductUserDataPaths(appDataPath: string, argv: readonly string[]): ProductUserDataPaths {
  const explicitPath = userDataPathFromArgv(argv);
  const currentPath = explicitPath ?? join(appDataPath, PRODUCT_NAME);
  const migrationRoot = explicitPath ? dirname(currentPath) : appDataPath;
  return {
    legacyPath: join(migrationRoot, LEGACY_PRODUCT_NAME),
    currentPath,
    appDataPath,
    explicitUserDataPath: Boolean(explicitPath),
  };
}

export function configureProductIdentity(electronApp: App, argv: readonly string[]): ProductUserDataPaths {
  electronApp.setName(PRODUCT_NAME);
  if (process.platform === "win32") electronApp.setAppUserModelId(PRODUCT_APP_ID);

  const paths = resolveProductUserDataPaths(electronApp.getPath("appData"), argv);
  electronApp.setPath("userData", paths.currentPath);
  return paths;
}

/**
 * Restores only the legacy OS credential identity for the short-lived secret
 * migration helper. The helper never creates a window or starts app services.
 */
export function configureLegacyProductIdentity(electronApp: App, argv: readonly string[]): void {
  electronApp.setName(LEGACY_PRODUCT_NAME);
  if (process.platform === "win32") electronApp.setAppUserModelId(LEGACY_PRODUCT_APP_ID);
  const explicitPath = userDataPathFromArgv(argv);
  if (explicitPath) electronApp.setPath("userData", explicitPath);
}
