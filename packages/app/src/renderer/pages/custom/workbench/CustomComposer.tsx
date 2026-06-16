import { ArrowUp, Folder, FolderOpen, Square, X } from "lucide-react";
import type { RefObject } from "react";
import { useCustomChatStore } from "../../../stores/customChat.store";
import SelectDropdown from "../../../components/ui/SelectDropdown";
import CustomApprovalCard from "./CustomApprovalCard";
import { composerSizeStyle, shortPath } from "./helpers";

type SelectOption = { value: string; label: string };

type CustomComposerProps = {
  draft: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  hasActiveProvider: boolean;
  canSend: boolean;
  activeProviderId: string | null;
  providerSelectOptions: SelectOption[];
  workspaceRoot: string | null;
  contextUsageState: string;
  contextUsageTitle: string;
  contextBlockCount: number;
  contextBlocksOn: number;
  contextCompactLabel: string;
  collapsedApprovals: Record<string, boolean>;
  onToggleApprovalCollapsed: (approvalId: string) => void;
  onOpenConfig: () => void;
  onDraftChange: (value: string, el: HTMLTextAreaElement) => void;
  onSubmit: () => void;
  onSelectProvider: (id: string) => void;
  onPickWorkspace: () => void;
  onClearWorkspace: () => void;
};

// 自定义对话输入区：待审批卡片 + 输入框 + provider 选择 / 工作区 / 上下文用量 + 发送 / 停止。
export default function CustomComposer({
  draft,
  inputRef,
  hasActiveProvider,
  canSend,
  activeProviderId,
  providerSelectOptions,
  workspaceRoot,
  contextUsageState,
  contextUsageTitle,
  contextBlockCount,
  contextBlocksOn,
  contextCompactLabel,
  collapsedApprovals,
  onToggleApprovalCollapsed,
  onOpenConfig,
  onDraftChange,
  onSubmit,
  onSelectProvider,
  onPickWorkspace,
  onClearWorkspace,
}: CustomComposerProps) {
  const customChatStore = useCustomChatStore();

  return (
    <footer className="cw-composer">
      {customChatStore.pendingApprovals.length > 0 ? (
        <div className="cw-approvals">
          {customChatStore.pendingApprovals.map((approval) => (
            <CustomApprovalCard
              key={approval.approvalId}
              approval={approval}
              collapsed={Boolean(collapsedApprovals[approval.approvalId])}
              onToggleCollapsed={() => onToggleApprovalCollapsed(approval.approvalId)}
              onRespond={(approvalId, approved) => void customChatStore.respondApproval(approvalId, approved)}
            />
          ))}
        </div>
      ) : null}
      {!hasActiveProvider ? (
        <p className="cw-composer__warn">
          尚未配置可用 Provider，
          <button type="button" className="cw-link" onClick={onOpenConfig}>
            点此配置
          </button>
          。
        </p>
      ) : (
        <div className={`cw-shell${customChatStore.sending ? " is-sending" : ""}`}>
          <textarea
            ref={inputRef}
            className="cw-shell__input app-scrollbar"
            value={draft}
            style={composerSizeStyle}
            placeholder="给自定义模型发消息…（Enter 发送，Shift+Enter 换行）"
            disabled={customChatStore.sending}
            onChange={(event) => onDraftChange(event.target.value, event.target as HTMLTextAreaElement)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              onSubmit();
            }}
          />
          <div className="cw-shell__bar">
            <div className="cw-shell__left">
              <SelectDropdown
                className="cw-model-select"
                modelValue={activeProviderId ?? ""}
                options={providerSelectOptions}
                disabled={customChatStore.sending}
                ariaLabel="选择 Provider"
                minPopoverWidth={260}
                onValueChange={onSelectProvider}
              />
              <button
                className={`cw-tool-chip${workspaceRoot ? " is-set" : ""}`}
                type="button"
                title={workspaceRoot || "未选择工作区（使用系统工具，根目录为进程 cwd）"}
                onClick={onPickWorkspace}
              >
                {workspaceRoot ? <FolderOpen className="cw-tool-chip__icon" aria-hidden="true" /> : <Folder className="cw-tool-chip__icon" aria-hidden="true" />}
                <span className="cw-tool-chip__label">{shortPath(workspaceRoot ?? "") || "工作区"}</span>
                {workspaceRoot ? (
                  <span
                    className="cw-tool-chip__clear"
                    role="button"
                    aria-label="清除工作区"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClearWorkspace();
                    }}
                  >
                    <X className="cw-tool-chip__clear-icon" aria-hidden="true" />
                  </span>
                ) : null}
              </button>
            </div>
            <div className="cw-shell__right">
              <span className={`cw-context-chip cw-context-chip--${contextUsageState}`} title={contextUsageTitle}>
                <span className="cw-context-blocks" aria-hidden="true">
                  {Array.from({ length: contextBlockCount }, (_, index) => (
                    <span key={index} className={`cw-context-blocks__cell${index < contextBlocksOn ? " is-on" : ""}`} />
                  ))}
                </span>
                <span className="cw-context-chip__label">{contextCompactLabel}</span>
              </span>
              {customChatStore.sending ? (
                <button className="cw-send-btn cw-send-btn--stop" type="button" aria-label="停止生成" onClick={() => void customChatStore.cancelCurrentRun()}>
                  <Square className="cw-send-btn__icon" aria-hidden="true" />
                </button>
              ) : (
                <button className="cw-send-btn" type="button" aria-label="发送" disabled={!canSend} onClick={onSubmit}>
                  <ArrowUp className="cw-send-btn__icon" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
