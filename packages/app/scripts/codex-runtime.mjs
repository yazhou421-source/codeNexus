#!/usr/bin/env node
import {
  fetchRuntime,
  loadRuntimeManifest,
  runtimeKeyForNode,
  supportedRuntimeKeys,
  verifyRuntime,
} from "./codex-runtime-lib.mjs";

function requestedKeys(manifest) {
  const platformFlag = process.argv.indexOf("--platform");
  const requested = platformFlag >= 0 ? String(process.argv[platformFlag + 1] ?? "").trim() : "";
  if (platformFlag >= 0 && !requested) throw new Error("--platform requires a runtime key");
  if (requested === "all") return supportedRuntimeKeys(manifest);
  if (requested) return [requested];
  const current = runtimeKeyForNode();
  if (!current) throw new Error(`No bundled Codex runtime is configured for ${process.platform}-${process.arch}`);
  return [current];
}

const command = String(process.argv[2] ?? "").trim();
if (!new Set(["fetch", "verify"]).has(command)) {
  throw new Error("Usage: codex-runtime.mjs <fetch|verify> [--platform mac-arm64|win-x64|all]");
}

const manifest = await loadRuntimeManifest();
for (const runtimeKey of requestedKeys(manifest)) {
  const result = command === "fetch" ? await fetchRuntime(runtimeKey) : await verifyRuntime(runtimeKey, { manifest });
  console.info(
    `[codex-runtime] ${command === "fetch" ? "prepared" : "verified"} ${runtimeKey} ` +
      `Codex ${result.manifest.version} at ${result.root}`
  );
}
