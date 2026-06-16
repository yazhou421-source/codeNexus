// Vite 配置：仅用于渲染进程构建与本地开发端口设置。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// 代码高亮包
const CODEMIRROR_RESOLVE_PACKAGES = [
  "codemirror",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/language-data",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/highlight",
];

const MANUAL_VENDOR_CHUNKS: Array<{ chunk: string; packages: string[] }> = [
  { chunk: "react", packages: ["react", "react-dom", "zustand", "i18next", "react-i18next"] },
  { chunk: "ui", packages: ["lucide-react", "@iconify/react", "@iconify/icons-vscode-icons"] },
  { chunk: "flowchart", packages: ["@xyflow/react"] },
  { chunk: "markdown", packages: ["markdown-it", "dompurify"] },
  {
    chunk: "editor",
    packages: CODEMIRROR_RESOLVE_PACKAGES,
  },
];

function isPackageModule(normalizedId: string, packageName: string) {
  return (
    normalizedId.includes(`/node_modules/${packageName}/`) || normalizedId.endsWith(`/node_modules/${packageName}`)
  );
}

function manualChunks(id: string) {
  const normalizedId = id.replace(/\\/g, "/");
  if (normalizedId.includes("vite/preload-helper")) return "preload-helper";
  for (const group of MANUAL_VENDOR_CHUNKS) {
    if (group.packages.some((packageName) => isPackageModule(normalizedId, packageName))) {
      return group.chunk;
    }
  }
  return undefined;
}

export default defineConfig(({ command }) => {
  return {
    plugins: [react()],
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: CODEMIRROR_RESOLVE_PACKAGES.map((packageName) => ({
        find: packageName,
        replacement: resolve(__dirname, "node_modules", packageName),
      })),
      dedupe: CODEMIRROR_RESOLVE_PACKAGES,
    },
    // Electron 生产态使用 file:// 加载 index.html，必须使用相对路径引用 assets，避免出现白屏。
    base: command === "build" ? "./" : "/",
    build: {
      outDir: resolve(__dirname, "dist/renderer"),
      emptyOutDir: true,
      // Electron 通过本地 file:// 加载，提前 modulepreload 动态块收益有限；
      // 关闭 HTML 级 modulepreload，避免首屏主动预取设置页、编辑器等低频异步视图。
      modulePreload: false,
      // 语法高亮和图表渲染的语言/布局块较多，提升阈值避免噪音告警。
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
