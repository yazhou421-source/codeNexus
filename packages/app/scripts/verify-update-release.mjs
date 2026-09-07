import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function verifyTag(version, tag) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(tag, `v${version}`, "Release tag must equal package version");
}
export async function verifyAssets(directory, version) {
  const { parse } = await import("yaml");
  const raw = await readFile(resolve(directory, "latest-mac.yml"), "utf8");
  const info = parse(raw);
  assert.equal(info.version, version);
  assert.ok(Number.isFinite(Date.parse(info.releaseDate)), "releaseDate required");
  const names = ["zip", "dmg"].map((ext) => `Calmnova-Code-${version}-arm64.${ext}`);
  assert.equal(info.files.length, 2, "Exactly ZIP and DMG required");
  for (const name of names) {
    const file = info.files.find((entry) => entry.url === name);
    assert.ok(file, `Missing metadata for ${name}`);
    assert.equal(file.size, (await stat(resolve(directory, name))).size);
    assert.equal(
      file.sha512,
      createHash("sha512")
        .update(await readFile(resolve(directory, name)))
        .digest("base64")
    );
    assert.ok((await stat(resolve(directory, `${name}.blockmap`))).size > 0);
    assert.deepEqual(Object.keys(file).sort(), ["sha512", "size", "url"]);
  }
  assert.equal(info.path, names[0]);
  assert.equal(info.sha512, info.files.find((entry) => entry.url === names[0]).sha512);
  assert.deepEqual(Object.keys(info).sort(), ["files", "path", "releaseDate", "sha512", "version"]);
  // Relative, exact asset names and an allowlist of metadata keys preclude local paths/credentials.
  return {
    version,
    assets: [...names, ...names.map((name) => `${name}.blockmap`), "latest-mac.yml"],
    sha512: "verified",
    size: "verified",
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const value = (flag) => process.argv[process.argv.indexOf(flag) + 1];
  verifyTag(version, value("--tag"));
  if (process.argv.includes("--assets"))
    console.log(JSON.stringify(await verifyAssets(resolve(value("--assets")), version), null, 2));
  else console.log(`Version/tag verified: v${version}`);
}
