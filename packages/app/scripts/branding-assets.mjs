import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const pngToIcoEntry = require.resolve("png-to-ico");
const { imagesToIco } = await import(pathToFileURL(pngToIcoEntry).href);
const { readPNG, resize: resizePngData } = await import(
  pathToFileURL(resolve(dirname(pngToIcoEntry), "lib", "png.js")).href
);
const electronBuilderRequire = createRequire(require.resolve("electron-builder"));
const { appBuilderPath } = electronBuilderRequire("app-builder-bin");
const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const brandingRoot = resolve(appRoot, "build", "branding");
const rendererBrandingRoot = resolve(appRoot, "src", "renderer", "assets", "branding");

const appIconMaster = resolve(brandingRoot, "app-icon-1024.png");
const macIcon = resolve(appRoot, "build", "icon.icns");
const windowsIcon = resolve(appRoot, "build", "icon.ico");

const requiredSourceAssets = [
  "app-icon-1024.png",
  "logo-dark.png",
  "logo-light.png",
  "logo-dark-subtitle.png",
  "logo-light-subtitle.png",
  "symbol.png",
];
const requiredRendererAssets = ["logo-dark.png", "logo-light.png", "symbol.png"];
const windowsIconSizes = [16, 24, 32, 48, 64, 128, 256];
const requiredIcnsTypes = ["ic11", "ic12", "ic07", "ic08", "ic13", "ic09", "ic14", "ic10"];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function pngDimensions(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a" || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("invalid PNG image");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function icoSizes(buffer) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error("invalid Windows ICO image");
  }
  const count = buffer.readUInt16LE(4);
  if (buffer.length < 6 + count * 16) throw new Error("truncated Windows ICO image");
  return Array.from({ length: count }, (_, index) => {
    const width = buffer.readUInt8(6 + index * 16);
    return width === 0 ? 256 : width;
  });
}

function icnsTypes(buffer) {
  if (buffer.length < 8 || buffer.subarray(0, 4).toString("ascii") !== "icns") {
    throw new Error("invalid macOS ICNS image");
  }
  const declaredLength = buffer.readUInt32BE(4);
  if (declaredLength !== buffer.length) throw new Error("invalid macOS ICNS length");

  const types = [];
  let offset = 8;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new Error("truncated macOS ICNS image");
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const length = buffer.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > buffer.length) throw new Error(`invalid macOS ICNS chunk ${type}`);
    types.push(type);
    offset += length;
  }
  return types;
}

function assertIncludesAll(actual, expected, label) {
  const missing = expected.filter((value) => !actual.includes(value));
  if (missing.length) throw new Error(`${label} is missing: ${missing.join(", ")}`);
}

async function runSips(args) {
  if (process.platform !== "darwin") {
    throw new Error(
      "Calmnova icon generation requires macOS sips/iconutil; generated assets are committed for other hosts"
    );
  }
  await execFileAsync("/usr/bin/sips", args);
}

async function cropAndResizePng(source, crop, destination, output) {
  const temporaryCrop = `${destination}.crop.png`;
  await runSips([
    "-c",
    String(crop.height),
    String(crop.width),
    "--cropOffset",
    String(crop.y),
    String(crop.x),
    source,
    "--out",
    temporaryCrop,
  ]);
  try {
    await runSips(["-z", String(output.height), String(output.width), temporaryCrop, "--out", destination]);
  } finally {
    await rm(temporaryCrop, { force: true });
  }
}

export async function generateBrandingAssets() {
  if (!(await exists(appIconMaster))) throw new Error(`Calmnova app icon master not found: ${appIconMaster}`);

  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "calmnova-branding-"));
  try {
    const masterPng = await readPNG(appIconMaster);
    const icnsOutput = resolve(temporaryRoot, "icns");
    const { stdout } = await execFileAsync(appBuilderPath, [
      "icon",
      "--format",
      "icns",
      "--root",
      brandingRoot,
      "--out",
      icnsOutput,
      "--input",
      "app-icon-1024.png",
    ]);
    const iconResult = JSON.parse(stdout);
    if (!Array.isArray(iconResult.icons) || iconResult.icons.length === 0 || iconResult.isFallback) {
      throw new Error("electron-builder did not generate the Calmnova macOS icon");
    }
    await copyFile(iconResult.icons[0].file, macIcon);

    const windowsImages = windowsIconSizes.map((size) => resizePngData(masterPng, size, size));
    await writeFile(windowsIcon, imagesToIco(windowsImages));

    await mkdir(rendererBrandingRoot, { recursive: true });
    await cropAndResizePng(
      resolve(brandingRoot, "symbol.png"),
      { x: 453, y: 138, width: 704, height: 704 },
      resolve(rendererBrandingRoot, "symbol.png"),
      { width: 512, height: 512 }
    );
    for (const name of ["logo-dark.png", "logo-light.png"]) {
      await cropAndResizePng(
        resolve(brandingRoot, name),
        { x: 123, y: 337, width: 1246, height: 296 },
        resolve(rendererBrandingRoot, name),
        { width: 1024, height: 243 }
      );
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  return verifyBrandingAssets();
}

export async function verifyBrandingAssets() {
  for (const name of requiredSourceAssets) {
    if (!(await exists(resolve(brandingRoot, name)))) throw new Error(`missing Calmnova brand source: ${name}`);
  }
  for (const name of requiredRendererAssets) {
    if (!(await exists(resolve(rendererBrandingRoot, name)))) throw new Error(`missing renderer brand asset: ${name}`);
  }

  const masterSize = pngDimensions(await readFile(appIconMaster));
  if (masterSize.width !== masterSize.height || masterSize.width < 1024) {
    throw new Error(`app icon master must be square and at least 1024px; got ${masterSize.width}x${masterSize.height}`);
  }
  const symbolSize = pngDimensions(await readFile(resolve(rendererBrandingRoot, "symbol.png")));
  if (symbolSize.width !== 512 || symbolSize.height !== 512) throw new Error("renderer symbol must be 512x512");
  for (const name of ["logo-dark.png", "logo-light.png"]) {
    const dimensions = pngDimensions(await readFile(resolve(rendererBrandingRoot, name)));
    if (dimensions.width !== 1024 || dimensions.height !== 243) {
      throw new Error(`${name} must be 1024x243`);
    }
  }

  const actualWindowsSizes = icoSizes(await readFile(windowsIcon));
  assertIncludesAll(actualWindowsSizes, windowsIconSizes, "Windows icon");
  const actualIcnsTypes = icnsTypes(await readFile(macIcon));
  assertIncludesAll(actualIcnsTypes, requiredIcnsTypes, "macOS icon");

  const result = {
    master: `${masterSize.width}x${masterSize.height}`,
    macIconTypes: actualIcnsTypes,
    windowsIconSizes: actualWindowsSizes,
    rendererAssets: requiredRendererAssets,
  };
  console.info(
    `[branding] verified Calmnova assets: master=${result.master}, ` +
      `windows=${actualWindowsSizes.join("/")}px, macOS=${requiredIcnsTypes.join("/")}`
  );
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2] ?? "verify";
  const action = command === "generate" ? generateBrandingAssets : command === "verify" ? verifyBrandingAssets : null;
  if (!action) {
    console.error("Usage: node scripts/branding-assets.mjs <generate|verify>");
    process.exit(2);
  }
  action().catch((error) => {
    console.error(error?.stack || String(error));
    process.exit(1);
  });
}
