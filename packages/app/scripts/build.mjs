import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeBundledNotices } from "./bundled-notices.mjs";
import { verifyBrandingAssets } from "./branding-assets.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const nodeExec = process.execPath;
const npmExecPath = process.env.npm_execpath;
const pnpmFallback = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

await verifyBrandingAssets();
mkdirSync(resolve(projectRoot, ".cache/bundle"), { recursive: true });

function runPnpm(args) {
  const options = {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  };
  const packageManagerArgs = withExecSeparator(args);

  if (npmExecPath) {
    execFileSync(nodeExec, [npmExecPath, ...packageManagerArgs], options);
    return;
  }

  execFileSync(pnpmFallback, packageManagerArgs, options);
}

function withExecSeparator(args) {
  if (args[0] !== "exec" || args[1] === "--") return args;
  return ["exec", "--", ...args.slice(1)];
}

// Remove only generated output, including source maps left by a previous dev build.
rmSync(resolve(projectRoot, "dist"), { recursive: true, force: true });
runPnpm(["exec", "vite", "build"]);

runPnpm([
  "exec",
  "esbuild",
  "src/main/main.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node20",
  "--external:electron",
  "--minify-syntax",
  "--minify-whitespace",
  "--outfile=dist/main.cjs",
  "--metafile=.cache/bundle/main.json",
]);

runPnpm([
  "exec",
  "esbuild",
  "src/preload/preload.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node20",
  "--external:electron",
  "--minify-syntax",
  "--minify-whitespace",
  "--outfile=dist/preload.cjs",
  "--metafile=.cache/bundle/preload.json",
]);

// Packaging excludes node_modules. Fail the build if a future import escapes bundling.
for (const name of ["main", "preload"]) {
  const metadata = JSON.parse(readFileSync(resolve(projectRoot, `.cache/bundle/${name}.json`), "utf8"));
  for (const output of Object.values(metadata.outputs)) {
    for (const entry of output.imports) {
      if (entry.external && entry.path !== "electron" && !isBuiltin(entry.path)) {
        throw new Error(`Unbundled runtime dependency in ${name}: ${entry.path}`);
      }
    }
  }
}

writeBundledNotices();
