import { codexDesktop } from "../../api/codexDesktopClient";
import type { useAppShellStore } from "../../stores/appShell.store";

type AppShellStore = ReturnType<typeof useAppShellStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

export type EnvironmentRuntimeDeps = {
  appTimelineId: string;
  appShellStore: AppShellStore;
  pushEvent: PushEvent;
  translate: TranslateFn;
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
  const { appTimelineId, appShellStore, pushEvent, translate, showToast } = deps;

  const checkEnvironment = async () => {
    showToast({
      kind: "info",
      title: translate("runtime.checkEnvironmentTitle"),
      message: translate("runtime.checkingRuntime"),
    });

    try {
      const res = await codexDesktop.codexServer.getDiagnostics();
      const ready = res.selfContained
        ? Boolean(res.codex.ok)
        : Boolean(res.codex.ok) && Boolean(res.node.ok) && Boolean(res.npm.ok);
      const details = [
        translate("runtime.diagnosticLine", {
          name: "codex",
          status: res.codex.ok ? translate("runtime.diagnosticOk") : translate("runtime.diagnosticMissing"),
        }),
        String(res.codex.details ?? "").trim(),
        ...(res.selfContained
          ? []
          : [
              translate("runtime.diagnosticLine", {
                name: "node",
                status: res.node.ok ? translate("runtime.diagnosticOk") : translate("runtime.diagnosticMissing"),
              }),
              String(res.node.details ?? "").trim(),
              translate("runtime.diagnosticLine", {
                name: "npm",
                status: res.npm.ok ? translate("runtime.diagnosticOk") : translate("runtime.diagnosticMissing"),
              }),
              String(res.npm.details ?? "").trim(),
            ]),
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
          title: translate("runtime.environmentReadyTitle"),
          message: translate(res.selfContained ? "runtime.bundledRuntimeReady" : "runtime.codexNodeNpmReady"),
        });
        return;
      }

      appShellStore.openSettings("env");
      showToast({
        kind: "warn",
        title: translate("runtime.environmentNotReadyTitle"),
        message: translate(res.selfContained ? "runtime.bundledRuntimeRepairHint" : "runtime.environmentInstallHint"),
      });
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      showToast({ kind: "error", title: translate("runtime.checkFailedTitle"), message: msg });
      pushEvent("env:error", msg, { threadId: appTimelineId, level: "error" });
    }
  };

  return { checkEnvironment };
}
