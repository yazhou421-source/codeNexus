import { pathToFileURL } from "node:url";
import { generateBrandingAssets } from "./branding-assets.mjs";

export async function ensureWinIcon() {
  await generateBrandingAssets();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureWinIcon().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}
