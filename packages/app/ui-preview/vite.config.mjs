import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
const here = (path) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  root: here("./"),
  plugins: [
    ...(process.env.UI_BASELINE === "1"
      ? [
          {
            name: "fixed-ui-baseline",
            enforce: "pre",
            load(id) {
              if (id.includes("?")) return null;
              const path = id.split("?")[0];
              const prefix = here("../src/renderer/");
              if (!path.startsWith(prefix) || !/\.(vue|css|ts)$/.test(path)) return null;
              return execFileSync(
                "git",
                [
                  "show",
                  `c00e9b7f2b85985423dbcc7919b7058bc8218010:packages/app/src/renderer/${path.slice(prefix.length)}`,
                ],
                { cwd: here("../../../"), encoding: "utf8" }
              );
            },
          },
        ]
      : []),
    vue(),
  ],
  resolve: {
    alias: [
      { find: /^.*\/domain\/runtimeOrchestrator$/, replacement: here("./runtime.mjs") },
      { find: /^.*\/api\/codexDesktopClient$/, replacement: here("./desktop.mjs") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: process.env.UI_BASELINE === "1" ? 5200 : 5199,
    strictPort: true,
    fs: { allow: [here("../../../")] },
  },
});
