import type { CodexDesktopAppApi } from "@codenexus/shared/ipc";

export type SystemNotificationVisibilityState = {
  focused: boolean;
  hidden: boolean;
  minimized: boolean;
};

export function shouldSendSystemNotification(state: SystemNotificationVisibilityState): boolean {
  return Boolean(state.hidden || state.minimized || !state.focused);
}

export async function notifyTurnCompleted(args: {
  app: Pick<CodexDesktopAppApi, "showSystemNotification">;
  focused: boolean;
  hidden: boolean;
  minimized: boolean;
  threadTitle?: string | null;
}): Promise<void> {
  if (!shouldSendSystemNotification(args)) return;
  const title = String(args.threadTitle ?? "").trim() || "Codex";
  try {
    await args.app.showSystemNotification({
      title: "任务完成",
      body: `${title} 已完成一次回复。`,
      silent: false,
    });
  } catch (error) {
    console.warn("[systemNotification] show failed", error);
  }
}
