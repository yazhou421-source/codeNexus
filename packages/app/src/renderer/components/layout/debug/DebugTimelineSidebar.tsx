import { useEffect, useMemo } from "react";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useCustomChatStore } from "../../../stores/customChat.store";
import { useDebugTimelineStore } from "../../../stores/debugTimeline.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useUiPrefsStore } from "../../../stores/uiPrefs.store";
import { useTimelineStore } from "../../../stores/timeline.store";
import ChatPane from "../chat/ChatPane";

type DebugTimelineSidebarProps = {
  className?: string;
};

export default function DebugTimelineSidebar({ className }: DebugTimelineSidebarProps) {
  const appShellStore = useAppShellStore();
  const customChatStore = useCustomChatStore();
  const runtimeStore = useRuntimeStore();
  const uiPrefsStore = useUiPrefsStore();
  const timelineStore = useTimelineStore();
  const debugTimelineStore = useDebugTimelineStore();
  const isCustomMode = appShellStore.runtimeMode === "custom";
  const timelineKey = isCustomMode ? customChatStore.debugThreadId() : String(runtimeStore.timelineKey ?? "__app__");
  const workspaceRoot = isCustomMode ? customChatStore.currentWorkspaceRootForDebug() : String(runtimeStore.workspacePath ?? "").trim();
  const contentEvents = isCustomMode ? [] : timelineStore.eventsForThread(timelineKey);
  const debugEvents = debugTimelineStore.eventsForThread(timelineKey);
  const events = useMemo(() => {
    return [...contentEvents, ...debugEvents].sort((a, b) => {
      const ta = Number.isFinite(a.createdAt) ? a.createdAt : 0;
      const tb = Number.isFinite(b.createdAt) ? b.createdAt : 0;
      return ta === tb ? String(a.id).localeCompare(String(b.id)) : ta - tb;
    });
  }, [contentEvents, debugEvents, timelineStore.threadStructureRevisionForThread(timelineKey), timelineStore.threadContentRevisionForThread(timelineKey)]);

  useEffect(() => {
    debugTimelineStore.loadThread(timelineKey);
  }, [timelineKey]);

  return (
    <aside className={["sidebar", "sidebar-right", "debug-timeline-sidebar", className].filter(Boolean).join(" ")}>
      <header className="debug-timeline-sidebar-head">
        <div className="debug-timeline-sidebar-title">
          <span className="mono">调试 JSON</span>
          <span className="mono dim">事件时间线</span>
        </div>
        <div className="debug-timeline-sidebar-actions">
          <span className="mono dim text-[10px]">Ctrl/⌘ + Alt + J</span>
          <button className="btn-mini" type="button" onClick={() => uiPrefsStore.setTimelineDebugEnabled(false)}>
            关闭
          </button>
        </div>
      </header>
      <div className="debug-timeline-sidebar-body app-scrollbar" role="region" aria-label="调试 JSON 事件列表">
        <ChatPane
          contentEvents={events}
          contentRevision={events.length}
          workspaceRoot={workspaceRoot}
          timelineKey={timelineKey}
        />
      </div>
    </aside>
  );
}
