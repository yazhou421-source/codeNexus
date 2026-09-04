import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBrandingAssets } from "./branding-assets.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const nodeExec = process.execPath;
const npmExecPath = process.env.npm_execpath;
const pnpmFallback = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

await verifyBrandingAssets();

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
  "--outfile=dist/main.cjs",
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
  "--outfile=dist/preload.cjs",
]);
