import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(appRoot, "../..");
const sourceRoot = resolve(appRoot, "build/branding");
const rendererRoot = resolve(appRoot, "src/renderer/assets/branding");

function pngDimensions(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function icoSizes(buffer: Buffer): number[] {
  expect(buffer.readUInt16LE(0)).toBe(0);
  expect(buffer.readUInt16LE(2)).toBe(1);
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => buffer.readUInt8(6 + index * 16) || 256);
}

function icnsLayers(buffer: Buffer): Map<string, { width: number; height: number }> {
  expect(buffer.subarray(0, 4).toString("ascii")).toBe("icns");
  expect(buffer.readUInt32BE(4)).toBe(buffer.length);
  const layers = new Map<string, { width: number; height: number }>();
  let offset = 8;
  while (offset < buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const length = buffer.readUInt32BE(offset + 4);
    layers.set(type, pngDimensions(buffer.subarray(offset + 8, offset + length)));
    offset += length;
  }
  return layers;
}

describe("Calmnova Code branding assets", () => {
  it("keeps every supplied high-resolution brand source", async () => {
    const names = [
      "app-icon-1024.png",
      "logo-dark.png",
      "logo-light.png",
      "logo-dark-subtitle.png",
      "logo-light-subtitle.png",
      "symbol.png",
    ];
    await Promise.all(names.map((name) => access(resolve(sourceRoot, name))));
    const master = pngDimensions(await readFile(resolve(sourceRoot, "app-icon-1024.png")));
    expect(master.width).toBe(master.height);
    expect(master.width).toBeGreaterThanOrEqual(1024);
  });

  it("contains a complete 16–1024 px macOS ICNS", async () => {
    const layers = icnsLayers(await readFile(resolve(appRoot, "build/icon.icns")));
    expect(Object.fromEntries(layers)).toEqual({
      ic11: { width: 32, height: 32 },
      ic12: { width: 64, height: 64 },
      ic07: { width: 128, height: 128 },
      ic08: { width: 256, height: 256 },
      ic13: { width: 256, height: 256 },
      ic09: { width: 512, height: 512 },
      ic14: { width: 512, height: 512 },
      ic10: { width: 1024, height: 1024 },
    });
  });

  it("contains all required Windows ICO layers", async () => {
    expect(icoSizes(await readFile(resolve(appRoot, "build/icon.ico")))).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });

  it("uses cropped renderer assets instead of the app icon", async () => {
    expect(pngDimensions(await readFile(resolve(rendererRoot, "symbol.png")))).toEqual({ width: 512, height: 512 });
    for (const name of ["logo-dark.png", "logo-light.png"]) {
      expect(pngDimensions(await readFile(resolve(rendererRoot, name)))).toEqual({ width: 1024, height: 243 });
    }
    const component = await readFile(resolve(appRoot, "src/renderer/components/brand/BrandLogo.vue"), "utf8");
    expect(component).toContain('from "../../assets/branding/symbol.png"');
    expect(component).not.toContain("app-icon-1024.png");
  });

  it("selects authored light and dark wordmarks without CSS filters", async () => {
    const component = await readFile(resolve(appRoot, "src/renderer/components/brand/BrandLogo.vue"), "utf8");
    expect(component).toContain('data-brand-theme="light"');
    expect(component).toContain('data-brand-theme="dark"');
    expect(component).toContain(':global(html[data-tone="dark"])');
    expect(component).not.toMatch(/filter\s*:/);
  });

  it("renders the brand in onboarding with localized product promise", async () => {
    const onboarding = await readFile(
      resolve(appRoot, "src/renderer/components/onboarding/OnboardingFlow.vue"),
      "utf8"
    );
    const english = await readFile(resolve(appRoot, "src/renderer/i18n/messages/en-US.ts"), "utf8");
    const chinese = await readFile(resolve(appRoot, "src/renderer/i18n/messages/zh-CN.ts"), "utf8");
    expect(onboarding).toContain("<BrandLogo");
    expect(onboarding).toContain('t("onboarding.welcome.tagline")');
    expect(english).toContain("Powerful AI, calm experience.");
    expect(chinese).toContain("强大的 AI，从容的创造。");
  });

  it("configures macOS native icons, DMG layout, and About identity", async () => {
    const builder = await readFile(resolve(appRoot, "electron-builder.yml"), "utf8");
    const main = await readFile(resolve(appRoot, "src/main/main.ts"), "utf8");
    expect(builder).toContain("icon: build/icon.icns");
    expect(builder).not.toContain("win:");
    expect(builder).toContain("path: /Applications");
    expect(builder).not.toContain("nsis:");
    expect(builder).toContain("to: branding/app-icon.png");
    expect(main).toContain('version: "AI Coding Workspace"');
    expect(main).toContain("iconPath: aboutIconPath");
    expect(main).toContain("CodeNexus, CodexBridge, and OpenAI Codex");
  });

  it("removes the inherited visual dependency without removing attribution", async () => {
    const builder = await readFile(resolve(appRoot, "electron-builder.yml"), "utf8");
    const readme = await readFile(resolve(repositoryRoot, "README.md"), "utf8");
    expect(builder).not.toContain("CodeNexus.png");
    expect(readme).not.toContain("CodeNexus.png");
    expect(builder).toContain("licenses/CodeNexus-LICENSE.txt");
    await expect(access(resolve(repositoryRoot, "CodeNexus.png"))).rejects.toThrow();
  });
});
