// Opt-in, isolated GUI acceptance harness; never included in production.
import { build } from "esbuild";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ? await realpath(process.argv[2]) : "";
if (!/^\/private\/tmp\/calmnova-workspace-fix\.[A-Za-z0-9]+$/.test(target)) {
  throw new Error("Supply an isolated calmnova-workspace-fix temporary directory");
}
await build({
  entryPoints: [resolve(root, "scripts/workspace-agent-e2e-entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  outfile: resolve(target, "main.cjs"),
  define: { __TEST_APP_ROOT__: JSON.stringify(root) },
  plugins: [
    {
      name: "test-only-context",
      setup(plugin) {
        plugin.onLoad({ filter: /src\/main\/main\.ts$/ }, async ({ path }) => ({
          contents:
            (await readFile(path, "utf8")) +
            "\nexport function getTestContext() { return { providerRuntimeService, embeddedRouterManager, codexServerManager, mainWindow }; }",
          loader: "ts",
        }));
      },
    },
  ],
});
console.log("Isolated GUI harness built; no credential read");
