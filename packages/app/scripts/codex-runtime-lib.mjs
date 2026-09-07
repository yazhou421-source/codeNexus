import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join, posix, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptsDir = dirname(fileURLToPath(import.meta.url));
export const appDir = resolve(scriptsDir, "..");
export const manifestPath = join(appDir, "codex-runtime-manifest.json");
export const runtimeBuildDir = join(appDir, "build", "codex-runtime");
export const runtimeCacheDir = join(appDir, ".cache", "codex-runtime");
export const runtimeLicenseDir = join(appDir, "licenses");

function requireText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Codex runtime manifest field is missing: ${label}`);
  return text;
}

function requireSha256(value, label) {
  const digest = requireText(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Codex runtime manifest SHA-256 is invalid: ${label}`);
  return digest;
}

function requireSize(value, label) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Codex runtime manifest size is invalid: ${label}`);
  return size;
}

function requireRelativePath(value, label) {
  const path = requireText(value, label).replaceAll("\\", "/");
  const normalized = posix.normalize(path);
  if (normalized !== path || normalized.startsWith("../") || normalized.startsWith("/") || normalized === "..") {
    throw new Error(`Codex runtime manifest path is unsafe: ${label}`);
  }
  return path;
}

export async function loadRuntimeManifest() {
  const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  if (parsed?.schemaVersion !== 1) throw new Error("Unsupported Codex runtime manifest schema version");
  const version = requireText(parsed.version, "version");
  const releaseTag = requireText(parsed.releaseTag, "releaseTag");
  if (releaseTag !== `rust-v${version}`) throw new Error("Codex runtime release tag does not match its version");
  if (!parsed.platforms || typeof parsed.platforms !== "object") {
    throw new Error("Codex runtime manifest platforms are missing");
  }
  return parsed;
}

export function runtimeKeyForNode(platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && arch === "arm64") return "mac-arm64";
  if (platform === "win32" && arch === "x64") return "win-x64";
  return null;
}

export function runtimeKeyForBuilder(electronPlatformName, arch) {
  const archName = typeof arch === "number" ? { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64" }[arch] : arch;
  return runtimeKeyForNode(electronPlatformName, archName);
}

function platformDefinition(manifest, runtimeKey) {
  const definition = manifest.platforms?.[runtimeKey];
  if (!definition || typeof definition !== "object") {
    throw new Error(`Unsupported bundled Codex runtime target: ${runtimeKey}`);
  }
  const asset = definition.asset;
  const name = requireRelativePath(asset?.name, `${runtimeKey}.asset.name`);
  if (name.includes("/")) throw new Error(`Codex runtime asset name must not contain directories: ${name}`);
  const expectedUrl = `https://github.com/openai/codex/releases/download/${manifest.releaseTag}/${name}`;
  if (asset?.url !== expectedUrl)
    throw new Error(`Codex runtime asset URL is not the pinned OpenAI release URL: ${name}`);
  requireSha256(asset.sha256, `${runtimeKey}.asset.sha256`);
  requireSize(asset.size, `${runtimeKey}.asset.size`);
  requireRelativePath(definition.entrypoint, `${runtimeKey}.entrypoint`);
  if (!Array.isArray(definition.files) || definition.files.length === 0) {
    throw new Error(`Codex runtime file manifest is empty: ${runtimeKey}`);
  }
  const seen = new Set();
  for (const file of definition.files) {
    const path = requireRelativePath(file.path, `${runtimeKey}.files.path`);
    if (seen.has(path)) throw new Error(`Duplicate Codex runtime file manifest entry: ${path}`);
    seen.add(path);
    requireSha256(file.sha256, `${runtimeKey}.${path}.sha256`);
    requireSize(file.size, `${runtimeKey}.${path}.size`);
  }
  if (!seen.has(definition.entrypoint)) throw new Error(`Codex runtime entrypoint is not in its file manifest`);
  return definition;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyRuntimeFile(path, expected, label) {
  const metadata = await stat(path).catch(() => null);
  if (!metadata?.isFile()) throw new Error(`Codex runtime file is missing: ${label}`);
  const expectedSize = requireSize(expected.size, `${label}.size`);
  if (metadata.size !== expectedSize) {
    throw new Error(`Codex runtime file size mismatch: ${label} (expected ${expectedSize}, got ${metadata.size})`);
  }
  const expectedDigest = requireSha256(expected.sha256, `${label}.sha256`);
  const actualDigest = await sha256File(path);
  if (actualDigest !== expectedDigest) {
    throw new Error(`Codex runtime checksum mismatch: ${label} (expected ${expectedDigest}, got ${actualDigest})`);
  }
}

async function listFiles(root, relative = "") {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Codex runtime archive contains a symbolic link: ${child}`);
    if (entry.isDirectory()) files.push(...(await listFiles(root, child)));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`Codex runtime archive contains an unsupported entry: ${child}`);
  }
  return files.sort();
}

async function verifyPackageDescriptor(root, manifest, definition) {
  const descriptorPath = join(root, "codex-package.json");
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  const expected = {
    layoutVersion: 1,
    version: manifest.version,
    target: definition.target,
    variant: "codex",
    entrypoint: definition.entrypoint,
    resourcesDir: "codex-resources",
    pathDir: "codex-path",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (descriptor?.[key] !== value) {
      throw new Error(
        `Codex package metadata mismatch for ${key}: expected ${value}, got ${String(descriptor?.[key])}`
      );
    }
  }
}

export async function verifyRuntime(runtimeKey, options = {}) {
  const manifest = options.manifest ?? (await loadRuntimeManifest());
  const definition = platformDefinition(manifest, runtimeKey);
  const root = options.root ?? join(runtimeBuildDir, runtimeKey);
  const actualFiles = await listFiles(root).catch((error) => {
    throw new Error(`Bundled Codex runtime is not prepared for ${runtimeKey}: ${error.message}`);
  });
  const expectedFiles = definition.files.map((file) => file.path).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `Codex runtime file set mismatch for ${runtimeKey}: expected ${expectedFiles.join(", ")}; got ${actualFiles.join(", ")}`
    );
  }
  for (const file of definition.files) {
    const path = join(root, ...file.path.split("/"));
    await verifyRuntimeFile(path, file, `${runtimeKey}/${file.path}`);
    if (file.executable && runtimeKey.startsWith("mac-")) {
      await access(path, constants.X_OK).catch(() => {
        throw new Error(`Codex runtime file is not executable: ${runtimeKey}/${file.path}`);
      });
    }
  }
  await verifyPackageDescriptor(root, manifest, definition);
  await verifyLicenses(manifest);
  return { manifest, definition, root };
}

async function verifyLicenses(manifest) {
  if (!Array.isArray(manifest.licenses) || manifest.licenses.length === 0) {
    throw new Error("Codex runtime license manifest is empty");
  }
  for (const license of manifest.licenses) {
    const name = requireRelativePath(license.name, "licenses.name");
    if (name.includes("/")) throw new Error(`Codex runtime license name must not contain directories: ${name}`);
    await verifyRuntimeFile(join(runtimeLicenseDir, name), license, `licenses/${name}`);
  }
}

async function downloadPinnedAsset(definition, destination) {
  const response = await fetch(definition.asset.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Codex runtime asset: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(destination, { flags: "wx" }));
}

async function ensureCachedAsset(runtimeKey, definition) {
  await mkdir(runtimeCacheDir, { recursive: true });
  const cachedPath = join(runtimeCacheDir, definition.asset.name);
  try {
    await verifyRuntimeFile(cachedPath, definition.asset, `${runtimeKey}/${definition.asset.name}`);
    return cachedPath;
  } catch {
    await rm(cachedPath, { force: true });
  }

  const partialPath = `${cachedPath}.partial-${process.pid}`;
  await rm(partialPath, { force: true });
  try {
    await downloadPinnedAsset(definition, partialPath);
    await verifyRuntimeFile(partialPath, definition.asset, `${runtimeKey}/${definition.asset.name}`);
    await rename(partialPath, cachedPath);
    return cachedPath;
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
}

function validateArchiveEntries(output, definition) {
  const expectedFiles = new Set(definition.files.map((file) => file.path));
  for (const rawEntry of String(output).split(/\r?\n/)) {
    const entry = rawEntry.trim().replace(/^\.\//, "");
    if (!entry) continue;
    const normalized = posix.normalize(entry);
    if (normalized.startsWith("../") || normalized.startsWith("/") || normalized === "..") {
      throw new Error(`Codex runtime archive contains an unsafe path: ${entry}`);
    }
    if (entry.endsWith("/")) continue;
    if (!expectedFiles.has(normalized)) throw new Error(`Codex runtime archive contains an unexpected file: ${entry}`);
  }
}

export async function fetchRuntime(runtimeKey) {
  const manifest = await loadRuntimeManifest();
  const definition = platformDefinition(manifest, runtimeKey);
  await verifyLicenses(manifest);
  const assetPath = await ensureCachedAsset(runtimeKey, definition);
  const { stdout: archiveEntries } = await execFileAsync("tar", ["-tzf", assetPath], { maxBuffer: 1024 * 1024 });
  validateArchiveEntries(archiveEntries, definition);

  await mkdir(runtimeBuildDir, { recursive: true });
  const target = join(runtimeBuildDir, runtimeKey);
  const staging = join(runtimeBuildDir, `.staging-${runtimeKey}-${process.pid}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await execFileAsync("tar", ["-xzf", assetPath, "-C", staging], { maxBuffer: 1024 * 1024 });
    if (runtimeKey.startsWith("mac-")) {
      for (const file of definition.files.filter((file) => file.executable)) {
        await chmod(join(staging, ...file.path.split("/")), 0o755);
      }
    }
    await verifyRuntime(runtimeKey, { manifest, root: staging });
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return verifyRuntime(runtimeKey, { manifest, root: target });
}

export function supportedRuntimeKeys(manifest) {
  return Object.keys(manifest.platforms).sort();
}
