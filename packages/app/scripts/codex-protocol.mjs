#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadRuntimeManifest, runtimeKeyForNode, verifyRuntime } from "./codex-runtime-lib.mjs";

const execFileAsync = promisify(execFile);
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptsDir, "..", "..", "..");
const generatedPackageDir = join(repositoryRoot, "packages", "generated");
const generatedTypesDir = join(generatedPackageDir, "src", "codex-app-server");
const generatedSchemaDir = join(generatedPackageDir, "schema", "codex-app-server");
const metadataPath = join(generatedPackageDir, "codex-protocol-metadata.json");

function slashPath(path) {
  return path.split(sep).join("/");
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Generated protocol contains a symbolic link: ${path}`);
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(slashPath(relative(root, path)));
    else throw new Error(`Generated protocol contains an unsupported entry: ${path}`);
  }
  return files.sort();
}

async function treeMetadata(root) {
  const files = await listFiles(root);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(join(root, ...file.split("/"))));
    hash.update("\0");
  }
  return { fileCount: files.length, sha256: hash.digest("hex"), files };
}

function expectedMetadata(manifest, types, schema) {
  return {
    schemaVersion: 1,
    codexVersion: manifest.version,
    releaseTag: manifest.releaseTag,
    sourceManifest: "packages/app/codex-runtime-manifest.json",
    generator: "bundled Codex app-server",
    experimental: true,
    outputs: {
      types: {
        directory: "packages/generated/src/codex-app-server",
        fileCount: types.fileCount,
        sha256: types.sha256,
      },
      jsonSchema: {
        directory: "packages/generated/schema/codex-app-server",
        fileCount: schema.fileCount,
        sha256: schema.sha256,
      },
    },
  };
}

async function readMetadata() {
  try {
    return JSON.parse(await readFile(metadataPath, "utf8"));
  } catch (error) {
    throw new Error(`Codex protocol metadata is missing or malformed: ${error.message}`);
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function verifyCommittedProtocol(manifest) {
  const [types, schema, committed] = await Promise.all([
    treeMetadata(generatedTypesDir),
    treeMetadata(generatedSchemaDir),
    readMetadata(),
  ]);
  const expected = expectedMetadata(manifest, types, schema);
  if (!sameJson(committed, expected)) {
    throw new Error(
      "Generated Codex protocol metadata or content is stale. Run `pnpm codex:types` with the pinned runtime prepared."
    );
  }
  return { types, schema, metadata: expected };
}

async function generateToTemporaryDirectory(manifest) {
  const runtimeKey = runtimeKeyForNode();
  if (!runtimeKey) throw new Error(`Protocol generation is unsupported on ${process.platform}-${process.arch}`);
  const runtime = await verifyRuntime(runtimeKey, { manifest });
  const executable = join(runtime.root, ...runtime.definition.entrypoint.split("/"));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "codenexus-codex-protocol-"));
  const types = join(temporaryRoot, "types");
  const schema = join(temporaryRoot, "schema");
  const codexHome = join(temporaryRoot, "codex-home");
  await Promise.all([mkdir(types), mkdir(schema), mkdir(codexHome)]);
  const environment = { ...process.env, CODEX_HOME: codexHome };
  const commonOptions = { env: environment, maxBuffer: 8 * 1024 * 1024, windowsHide: true };
  try {
    await execFileAsync(executable, ["app-server", "generate-ts", "--experimental", "--out", types], commonOptions);
    await execFileAsync(
      executable,
      ["app-server", "generate-json-schema", "--experimental", "--out", schema],
      commonOptions
    );
    return {
      temporaryRoot,
      typesDir: types,
      schemaDir: schema,
      types: await treeMetadata(types),
      schema: await treeMetadata(schema),
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function replaceDirectory(source, destination) {
  const staging = `${destination}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, staging, { recursive: true, force: false, errorOnExist: true });
  await rm(destination, { recursive: true, force: true });
  await rename(staging, destination);
}

async function generate(manifest) {
  const generated = await generateToTemporaryDirectory(manifest);
  try {
    await replaceDirectory(generated.typesDir, generatedTypesDir);
    await replaceDirectory(generated.schemaDir, generatedSchemaDir);
    const metadata = expectedMetadata(manifest, generated.types, generated.schema);
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    console.info(
      `[codex-protocol] generated Codex ${manifest.version}: ` +
        `${generated.types.fileCount} TypeScript files, ${generated.schema.fileCount} JSON schema files`
    );
  } finally {
    await rm(generated.temporaryRoot, { recursive: true, force: true });
  }
}

async function check(manifest) {
  const committed = await verifyCommittedProtocol(manifest);
  const generated = await generateToTemporaryDirectory(manifest);
  try {
    if (committed.types.sha256 !== generated.types.sha256 || committed.schema.sha256 !== generated.schema.sha256) {
      throw new Error(
        "Generated Codex protocol differs from bundled runtime output. Run `pnpm codex:types` and review the result."
      );
    }
    console.info(
      `[codex-protocol] reproducible Codex ${manifest.version}: ` +
        `${committed.types.fileCount} TypeScript files, ${committed.schema.fileCount} JSON schema files`
    );
  } finally {
    await rm(generated.temporaryRoot, { recursive: true, force: true });
  }
}

const command = String(process.argv[2] ?? "").trim();
if (!new Set(["generate", "verify", "check"]).has(command)) {
  throw new Error("Usage: codex-protocol.mjs <generate|verify|check>");
}

const manifest = await loadRuntimeManifest();
if (command === "generate") await generate(manifest);
else if (command === "check") await check(manifest);
else {
  const committed = await verifyCommittedProtocol(manifest);
  console.info(
    `[codex-protocol] verified metadata for Codex ${manifest.version}: ` +
      `${committed.types.fileCount} TypeScript files, ${committed.schema.fileCount} JSON schema files`
  );
}
