import { ChevronDown } from "lucide-react";
import type { CustomApprovalRequest } from "../../../stores/customChat.store";
import UnifiedDiffViewer from "../../../components/timeline/cards/UnifiedDiffViewer";
import { extractFilenameFromDetail, isDiffContent } from "./helpers";

// 单条审批卡：命令 / 文件写改确认，支持折叠详情与同意 / 拒绝。
export default function CustomApprovalCard({
  approval,
  collapsed,
  onToggleCollapsed,
  onRespond,
}: {
  approval: CustomApprovalRequest;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRespond: (approvalId: string, approved: boolean) => void;
}) {
  return (
    <div className={`cw-approval cw-approval--${approval.kind}`}>
      <div className="cw-approval__head">
        <span className="cw-approval__kind">{approval.kind === "command" ? "命令审批" : "文件写改审批"}</span>
        <span className="cw-approval__title mono">{approval.title}</span>
        <button
          type="button"
          className="cw-approval__toggle"
          aria-expanded={collapsed ? "false" : "true"}
          onClick={onToggleCollapsed}
        >
          <ChevronDown className={`cw-approval__chevron${collapsed ? "" : " is-open"}`} aria-hidden="true" />
        </button>
      </div>
      {!collapsed ? (
        isDiffContent(approval.detail) ? (
          <UnifiedDiffViewer
            diffText={approval.detail}
            ariaLabel={extractFilenameFromDetail(approval.detail)}
            className="cw-approval__diff-viewer"
          />
        ) : (
          <pre className="cw-approval__detail mono">{approval.detail}</pre>
        )
      ) : null}
      <div className="cw-approval__actions">
        <button className="cw-btn cw-btn--ghost-danger" type="button" onClick={() => onRespond(approval.approvalId, false)}>
          拒绝
        </button>
        <button className="cw-btn cw-btn--primary" type="button" onClick={() => onRespond(approval.approvalId, true)}>
          同意
        </button>
      </div>
    </div>
  );
}
