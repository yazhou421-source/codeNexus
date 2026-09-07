import "../src/renderer/tailwind.css";
import "../src/renderer/styles/index.css";
import "./desktop.mjs";
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import App from "../src/renderer/App.vue";
import { i18n } from "../src/renderer/i18n";
import { installTooltipDirective } from "../src/renderer/directives/tooltip";
import { useThemeStore } from "../src/renderer/stores/theme.store";
import { useRuntimeStore } from "../src/renderer/stores/runtime.store";
import { useThreadStore } from "../src/renderer/stores/thread.store";
import { useTimelineStore } from "../src/renderer/stores/timeline.store";
import { useAppShellStore } from "../src/renderer/stores/appShell.store";
import { useWorkspaceFilesStore } from "../src/renderer/stores/workspaceFiles.store";
import { useProviderRegistryStore } from "../src/renderer/stores/providerRegistry.store";
const pinia = createPinia();
const app = createApp(App).use(pinia).use(i18n);
installTooltipDirective(app);
app.mount("#app");
await nextTick();
const params = new URLSearchParams(location.search);
const scene = params.get("scene") || "empty";
const theme = params.get("theme") || "light";
useThemeStore(pinia).theme = theme;
document.documentElement.dataset.theme = theme;
document.documentElement.dataset.tone = ["light", "pink"].includes(theme) ? "light" : "dark";
const runtime = useRuntimeStore(pinia);
const shell = useAppShellStore(pinia);
const root = "/fictional/nova-studio";
runtime.workspacePath = root;
runtime.model = "gpt-5.2-codex";
runtime.reasoningEffort = "medium";
runtime.sandboxMode = "workspace-write";
shell.filesSidebarVisible = scene === "editor";
shell.leftSidebarVisible = true;
const threads = useThreadStore(pinia);
threads.threadHistory = [
  { id: "preview-thread", title: "为通知服务增加重试机制", cwd: root, meta: "", updatedAt: 1788652800000 },
  {
    id: "preview-long",
    title: "检查中文长标题与工作区路径在窄窗口中的展示效果",
    cwd: root,
    meta: "",
    updatedAt: 1788652700000,
  },
];
runtime.currentThreadId = scene === "empty" ? "" : "preview-thread";
const timeline = useTimelineStore(pinia);
if (scene !== "empty") {
  timeline.upsertEvent({
    threadId: "preview-thread",
    id: "user-1",
    method: "local/user",
    localKind: "user",
    paramsText: "为通知服务增加指数退避，保留已有错误处理。",
    turnId: "turn-1",
    createdAt: 1788652800000,
  });
  timeline.upsertEvent({
    threadId: "preview-thread",
    id: "tool-1",
    method: "item/completed",
    params: {
      threadId: "preview-thread",
      turnId: "turn-1",
      item: {
        id: "command-1",
        type: "commandExecution",
        command: "pnpm test notifications",
        cwd: root,
        status: "completed",
        exitCode: 0,
        aggregatedOutput: "✓ notifications.test.ts (3 tests)\nTest Files  1 passed (1)",
      },
    },
    paramsText: "pnpm test notifications",
    turnId: "turn-1",
    createdAt: 1788652801000,
  });
  timeline.upsertEvent({
    threadId: "preview-thread",
    id: "assistant-1",
    params: { item: { type: "agentMessage", phase: "final_answer" } },
    method: "item/agentMessage/delta",
    paramsText:
      "已增加重试逻辑。临时失败会逐步延长等待时间，达到上限后继续使用原有错误处理。\n\n```ts\nexport function retryDelay(attempt: number) {\n  return Math.min(1000 * 2 ** attempt, 30_000);\n}\n```\n\n- 保留原有请求参数和取消行为。\n- 三项通知测试通过。\n\n可以继续检查超时和服务不可用时的提示。",
    turnId: "turn-1",
    createdAt: 1788652802000,
  });
}
if (scene === "editor") {
  const files = useWorkspaceFilesStore(pinia);
  const path = `${root}/notifications.ts`;
  const content = "export function retryDelay(attempt: number) {\n  return Math.min(1000 * 2 ** attempt, 30_000);\n}\n";
  files.expandedDirectoryPaths = [root];
  files.workspacePath = root;
  files.directoryPath = root;
  files.treeEntriesByPath[root] = ["notifications.ts", "README.md", "package.json"].map((name) => ({
    fileName: name,
    path: `${root}/${name}`,
    isDirectory: false,
  }));
  files.entries = files.treeEntriesByPath[root];
  files.editorTabOrder = [path];
  files.activeEditorTabPath = path;
  files.editorTabsByPath[path] = {
    path,
    source: null,
    metadata: null,
    previewKind: "text",
    originalContent: content,
    draftContent: content,
    imageDataUrl: "",
    imageMimeType: "",
    encoding: "UTF-8",
    lineEnding: "LF",
    unsupportedReason: "",
    errorText: "",
    loading: false,
    saving: false,
  };
  shell.centerEditorWidthPx = 410;
}
if (scene === "settings") {
  const providers = useProviderRegistryStore(pinia);
  providers.loadState = "ready";
  providers.providers = [
    {
      id: "preview-service",
      displayName: "示例模型服务（虚构）",
      baseUrl: "https://example.invalid",
      api: "responses",
      requiresApiKey: true,
      defaultModelId: "preview-model",
      configured: false,
      enabled: false,
      models: [{ id: "preview-model", displayName: "示例模型", enabled: false }],
    },
  ];
  shell.settingsActiveTab = "models";
  shell.settingsOpen = true;
}

if (scene === "running") {
  threads.runningThreadIds.add("preview-thread");
}
if (scene === "error") {
  timeline.upsertEvent({
    threadId: "preview-thread",
    id: "error-preview",
    method: "error",
    level: "error",
    paramsText: "示例错误：请求暂时无法完成，请检查连接后重试。",
    turnId: "turn-1",
    createdAt: 1788652803000,
  });
}
