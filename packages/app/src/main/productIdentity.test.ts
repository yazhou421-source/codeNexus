import { describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import {
  LEGACY_PRODUCT_NAME,
  PRODUCT_APP_ID,
  PRODUCT_NAME,
  configureLegacyProductIdentity,
  configureProductIdentity,
  resolveProductUserDataPaths,
  userDataPathFromArgv,
} from "./productIdentity";

describe("productIdentity", () => {
  it("uses the new product name below Electron appData", () => {
    const appDataPath = resolve("fixture", "Application Support");
    expect(resolveProductUserDataPaths(appDataPath, ["electron"])).toEqual({
      legacyPath: join(appDataPath, LEGACY_PRODUCT_NAME),
      currentPath: join(appDataPath, PRODUCT_NAME),
      appDataPath,
      explicitUserDataPath: false,
    });
  });

  it("places the legacy path beside an explicit isolated userData directory", () => {
    const smokeRoot = resolve("fixture", "calmnova-smoke");
    const currentPath = join(smokeRoot, PRODUCT_NAME);
    expect(
      resolveProductUserDataPaths(resolve("real", "Application Support"), [
        "electron",
        `--user-data-dir=${currentPath}`,
      ])
    ).toMatchObject({
      legacyPath: join(smokeRoot, LEGACY_PRODUCT_NAME),
      currentPath,
      explicitUserDataPath: true,
    });
  });

  it("accepts both Chromium user-data-dir argument forms", () => {
    const separate = resolve("fixture", "separate");
    const inline = resolve("fixture", "inline");
    expect(userDataPathFromArgv(["app", "--user-data-dir", separate])).toBe(separate);
    expect(userDataPathFromArgv(["app", `--user-data-dir=${inline}`])).toBe(inline);
  });

  it("configures the name and userData path before services are created", () => {
    const setName = vi.fn();
    const setPath = vi.fn();
    const setAppUserModelId = vi.fn();
    const electronApp = {
      setName,
      setPath,
      setAppUserModelId,
      getPath: vi.fn(() => resolve("fixture", "Application Support")),
    };

    const paths = configureProductIdentity(electronApp as never, ["electron"]);
    expect(setName).toHaveBeenCalledWith(PRODUCT_NAME);
    expect(setPath).toHaveBeenCalledWith("userData", paths.currentPath);
    if (process.platform === "win32") expect(setAppUserModelId).toHaveBeenCalledWith(PRODUCT_APP_ID);
    else expect(setAppUserModelId).not.toHaveBeenCalled();
  });

  it("can enter the legacy credential identity without changing the requested isolated directory", () => {
    const setName = vi.fn();
    const setPath = vi.fn();
    const setAppUserModelId = vi.fn();
    const electronApp = { setName, setPath, setAppUserModelId };
    const legacyPath = resolve("fixture", "CodeNexus");

    configureLegacyProductIdentity(electronApp as never, ["electron", `--user-data-dir=${legacyPath}`]);

    expect(setName).toHaveBeenCalledWith(LEGACY_PRODUCT_NAME);
    expect(setPath).toHaveBeenCalledWith("userData", legacyPath);
  });
});
