import { useCustomChatStore } from "../../../stores/customChat.store";
import { formatSessionTime } from "./helpers";

type SessionSnapshot = { providerId: string | null; providerLabel: string | null; workspaceRoot: string | null };

// 左侧会话边栏：新建 / 切换 / 删除自定义对话会话。
export default function CustomSessionList({
  snapshot,
  onBeforeSwitch,
}: {
  snapshot: SessionSnapshot;
  onBeforeSwitch: () => void;
}) {
  const customChatStore = useCustomChatStore();

  return (
    <aside className="cw-sessions">
      <div className="cw-sessions__head">
        <strong>Custom 会话</strong>
        <button
          className="cw-btn cw-btn--compact cw-btn--primary"
          type="button"
          disabled={customChatStore.sending}
          onClick={() => {
            onBeforeSwitch();
            void customChatStore.newSession(snapshot);
          }}
        >
          + 新建
        </button>
      </div>
      {customChatStore.loadingSessions ? (
        <div className="cw-sessions__empty">加载中...</div>
      ) : customChatStore.sessions.length === 0 ? (
        <div className="cw-sessions__empty">暂无历史会话</div>
      ) : (
        <div className="cw-session-list app-scrollbar">
          {customChatStore.sessions.map((session) => (
            <div key={session.id} className={`cw-session${session.id === customChatStore.currentSessionId ? " is-active" : ""}`}>
              <button
                className="cw-session__main"
                type="button"
                disabled={customChatStore.sending}
                onClick={() => {
                  if (customChatStore.sending) return;
                  onBeforeSwitch();
                  void customChatStore.loadSession(session.id);
                }}
              >
                <span className="cw-session__title">{session.title || "新会话"}</span>
                <span className="cw-session__meta">{formatSessionTime(session.updatedAt)}</span>
                {session.providerLabel ? <span className="cw-session__provider">{session.providerLabel}</span> : null}
              </button>
              <button
                className="cw-session__delete"
                type="button"
                disabled={customChatStore.sending && session.id === customChatStore.currentSessionId}
                title="删除会话"
                onClick={() => void customChatStore.deleteSession(session.id, snapshot)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
