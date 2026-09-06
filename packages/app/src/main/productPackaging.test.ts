import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "../..");

describe("Calmnova Code packaging identity", () => {
  it("keeps package identity, installer names, updater repository, and attribution explicit", async () => {
    const packageJson = JSON.parse(await readFile(resolve(appRoot, "package.json"), "utf8"));
    const builder = await readFile(resolve(appRoot, "electron-builder.yml"), "utf8");

    expect(packageJson.name).toBe("@codenexus/app");
    expect(packageJson.productName).toBe("Calmnova Code");
    expect(packageJson.version).toBe("1.0.4");
    expect(builder).toContain("appId: com.calmnova.code");
    expect(builder).toContain("productName: Calmnova Code");
    expect(builder).not.toContain("win:");
    expect(builder).toContain('artifactName: "Calmnova-Code-${version}-${arch}.${ext}"');
    expect(builder).toContain("icon: build/icon.icns");
    expect(builder).not.toContain("nsis:");
    expect(builder).toContain('"!node_modules{,/**/*}"');
    expect(builder).toContain('"!**/*.map"');
    expect(packageJson.scripts.dist).toContain("--mac dmg zip --arm64 --publish never");
    expect(builder).toContain("publish: null");
    expect(builder).not.toContain("owner: QinQinChina");
    expect(builder).toContain("licenses/CodeNexus-LICENSE.txt");
    expect(builder).toContain("licenses/CodexBridge-LICENSE.txt");
    expect(builder).toContain("licenses/OpenAI-Codex-LICENSE.txt");
    expect(builder).toContain("licenses/Calmnova-Code-THIRD-PARTY-NOTICES.txt");
  });

  it("keeps the Codex runtime and generated protocol pinned together", async () => {
    const runtime = JSON.parse(await readFile(resolve(appRoot, "codex-runtime-manifest.json"), "utf8"));
    const protocol = JSON.parse(await readFile(resolve(appRoot, "../generated/codex-protocol-metadata.json"), "utf8"));
    expect(runtime.version).toBe("0.153.2");
    expect(Object.keys(runtime.platforms)).toEqual(["mac-arm64"]);
    expect(protocol.codexVersion).toBe("0.153.2");
  });
});
