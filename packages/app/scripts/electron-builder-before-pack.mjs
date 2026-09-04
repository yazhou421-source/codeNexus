import { runtimeKeyForBuilder, verifyRuntime } from "./codex-runtime-lib.mjs";
import { verifyBrandingAssets } from "./branding-assets.mjs";

export default async function beforePack(context) {
  await verifyBrandingAssets();
  const runtimeKey = runtimeKeyForBuilder(context.electronPlatformName, context.arch);
  if (!runtimeKey) {
    throw new Error(
      `No bundled Codex runtime is configured for ${context.electronPlatformName}-${String(context.arch)}`
    );
  }
  const result = await verifyRuntime(runtimeKey);
  console.info(`[codex-runtime] electron-builder verified ${runtimeKey} Codex ${result.manifest.version}`);
}
