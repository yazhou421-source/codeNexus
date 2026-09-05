// Opt-in local acceptance harness. Never imported by production build/release.
// Credentials remain in the real main-process ProviderRuntimeService/Router.
import { build } from "esbuild";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ? await realpath(process.argv[2]) : "";
if (!/^\/private\/tmp\/calmnova-deepseek-3-2c1\.[A-Za-z0-9]+$/.test(target)) {
  throw new Error("Supply the isolated 3.2C1 temporary directory; live tests are opt-in.");
}
await build({
  entryPoints: [resolve(root, "scripts/deepseek-live-entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  outfile: resolve(target, "live-main.cjs"),
  define: { __LIVE_APP_ROOT__: JSON.stringify(root) },
  plugins: [
    {
      name: "test-only-main-context",
      setup(plugin) {
        plugin.onLoad({ filter: /router\/src\/upstream\.js$/ }, async ({ path }) => {
          let contents = await readFile(path, "utf8");
          contents = 'import { proxyDeepSeekNativeEvaluation } from "./deepseek-native-evaluation.js";\n' + contents;
          const marker = '  if (route.api === "responses") {';
          if (!contents.includes(marker)) throw new Error("Router dispatch signature changed");
          contents = contents.replace(
            marker,
            '  if (route.provider === "deepseek" && route.api === "responses") return proxyDeepSeekNativeEvaluation(requestBody, route, history, res, context);\n' +
              marker
          );
          return { contents, loader: "js" };
        });
        plugin.onLoad({ filter: /src\/main\/main\.ts$/ }, async ({ path }) => ({
          contents:
            (await readFile(path, "utf8")) +
            `\nexport function getLiveContext() { return { providerRuntimeService, embeddedRouterManager, codexServerManager, mainWindow, runtimeThreadStateTracker }; }`,
          loader: "ts",
        }));
      },
    },
  ],
});
console.log("[deepseek-live] isolated harness built; no credential was read");
