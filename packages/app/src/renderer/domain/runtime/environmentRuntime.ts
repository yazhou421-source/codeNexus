import { codexDesktop } from "../../api/codexDesktopClient";
import type { useAppShellStore } from "../../stores/appShell.store";

type AppShellStore = ReturnType<typeof useAppShellStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

export type EnvironmentRuntimeDeps = {
  appTimelineId: string;
  appShellStore: AppShellStore;
  pushEvent: PushEvent;
  showToast: ShowToast;
};

export type EnvironmentRuntime = {
  checkEnvironment: () => Promise<void>;
};

function readErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error);
}

export function createEnvironmentRuntime(deps: EnvironmentRuntimeDeps): EnvironmentRuntime {
  const { appTimelineId, appShellStore, pushEvent, showToast } = deps;

  const checkEnvironment = async () => {
    showToast({
      kind: "info",
      title: "检查环境",
      message: "正在检测 codex/node/npm...",
    });

    try {
      const res = await codexDesktop.codexServer.getDiagnostics();
      const ready = Boolean(res.codex.ok) && Boolean(res.node.ok) && Boolean(res.npm.ok);
      const details = [
        `codex：${res.codex.ok ? "正常" : "缺失"}`,
        String(res.codex.details ?? "").trim(),
        `node：${res.node.ok ? "正常" : "缺失"}`,
        String(res.node.details ?? "").trim(),
        `npm：${res.npm.ok ? "正常" : "缺失"}`,
        String(res.npm.details ?? "").trim(),
      ]
        .filter(Boolean)
        .join("\n");

      pushEvent("env", details, {
        threadId: appTimelineId,
        level: ready ? "info" : "error",
      });

      if (ready) {
        showToast({
          kind: "success",
          title: "环境正常",
          message: "codex/node/npm 已就绪",
        });
        return;
      }

      appShellStore.openSettings("env");
      showToast({
        kind: "warn",
        title: "环境未就绪",
        message: "请按“环境检测”中的指引手动安装所需环境。",
      });
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      showToast({ kind: "error", title: "检查失败", message: msg });
      pushEvent("env:error", msg, { threadId: appTimelineId, level: "error" });
    }
  };

  return { checkEnvironment };
}
