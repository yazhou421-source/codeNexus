import { getRuntimeOrchestrator } from "../../domain/runtimeOrchestrator";
import type { ApprovalPrompt } from "../../stores/approval.store";
import { useApprovalStore } from "../../stores/approval.store";
import { useRuntimeStore } from "../../stores/runtime.store";
import { safeJsonStringify } from "../../utils/safeJson";
import GuardianReviewDiagnostics from "../guardian/GuardianReviewDiagnostics";

type ApprovalDockProps = {
  className?: string;
};

type ApprovalInfoRow = {
  label: string;
  value: string;
};

type CommandExecutionDecisionButton = {
  key: string;
  label: string;
  decision: unknown;
  kind: "primary" | "danger";
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function shortId(value: unknown) {
  const text = toText(value);
  if (!text) return "";
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function promptKey(prompt: ApprovalPrompt) {
  return `${prompt.serverId}:${prompt.requestId}`;
}

function promptAge(prompt: ApprovalPrompt) {
  const createdAt = Number(prompt.createdAt ?? 0);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return "刚刚";
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function headerText(prompt: ApprovalPrompt) {
  if (prompt.kind === "fileChange") return "文件变更请求";
  if (prompt.kind === "commandExecution") return "命令执行请求";
  if (prompt.kind === "permissions") return "权限请求";
  return "审批请求";
}

function metaText(prompt: ApprovalPrompt) {
  const method = toText(prompt.method);
  return [prompt.kind, method, promptAge(prompt)].filter(Boolean).join(" · ");
}

function queueItemMetaText(prompt: ApprovalPrompt) {
  return [shortId(prompt.threadId), shortId(prompt.itemId)].filter(Boolean).join(" / ") || toText(prompt.method);
}

function detailRows(prompt: ApprovalPrompt): ApprovalInfoRow[] {
  const params = toRecord(prompt.params);
  const reason = toText(params.reason);
  const grantRoot = toText(params.grantRoot);
  const cwd = toText(params.cwd);
  const command = Array.isArray(params.command)
    ? params.command.map((part) => toText(part)).filter(Boolean).join(" ")
    : toText(params.command);
  const rows: ApprovalInfoRow[] = [];
  if (reason) rows.push({ label: "申请原因", value: reason });
  if (grantRoot) rows.push({ label: "授权根", value: grantRoot });
  if (cwd) rows.push({ label: "工作目录", value: cwd });
  if (command) rows.push({ label: "命令", value: command });
  return rows;
}

function detailText(prompt: ApprovalPrompt) {
  if (prompt.kind === "permissions") return safeJsonStringify(prompt.params.permissions ?? {}, { space: 2 });
  return "";
}

function commandDecisionButtons(prompt: ApprovalPrompt): CommandExecutionDecisionButton[] {
  if (prompt.kind !== "commandExecution") return [];
  const decisions =
    Array.isArray(prompt.params.availableDecisions) && prompt.params.availableDecisions.length > 0
      ? prompt.params.availableDecisions
      : ["decline", "cancel", "acceptForSession", "accept"];
  const buttons: CommandExecutionDecisionButton[] = [];
  for (const decision of decisions) {
    if (decision === "accept") {
      buttons.push({ key: "accept", label: "允许", decision, kind: "primary" });
      continue;
    }
    if (decision === "acceptForSession") {
      buttons.push({
        key: "acceptForSession",
        label: "本会话允许",
        decision,
        kind: "primary",
      });
      continue;
    }
    if (decision === "decline") {
      buttons.push({ key: "decline", label: "拒绝", decision, kind: "danger" });
      continue;
    }
    if (decision === "cancel") {
      buttons.push({ key: "cancel", label: "拒绝并停止", decision, kind: "danger" });
      continue;
    }
    if (!decision || typeof decision !== "object") continue;
    if ("acceptWithExecpolicyAmendment" in decision) {
      buttons.push({
        key: "acceptWithExecpolicyAmendment",
        label: "允许并保存策略",
        decision,
        kind: "primary",
      });
      continue;
    }
    if ("applyNetworkPolicyAmendment" in decision) {
      const amendment = toRecord((decision as { applyNetworkPolicyAmendment?: unknown }).applyNetworkPolicyAmendment);
      const networkPolicyAmendment = toRecord(amendment.network_policy_amendment);
      const host = toText(networkPolicyAmendment.host);
      const action = toText(networkPolicyAmendment.action);
      const suffix = [action, host].filter(Boolean).join(" ");
      buttons.push({
        key: `applyNetworkPolicyAmendment:${action}:${host}`,
        label: suffix
          ? `应用网络策略：${suffix}`
          : "应用网络策略",
        decision,
        kind: "primary",
      });
      continue;
    }
    const fallbackKey = Object.keys(decision)[0] ?? "decision";
    buttons.push({ key: `obj:${fallbackKey}`, label: fallbackKey, decision, kind: "primary" });
  }
  return buttons.slice(0, 10);
}

export default function ApprovalDock({ className }: ApprovalDockProps) {
  const approvalStore = useApprovalStore();
  const runtimeStore = useRuntimeStore();
  const runtime = getRuntimeOrchestrator();
  const activePrompt = approvalStore.activePrompt;

  if (approvalStore.queue.length === 0) return null;

  const guardianThreadId =
    toText(activePrompt?.threadId) || toText(runtimeStore.currentThreadId) || toText(runtimeStore.timelineKey) || "__app__";
  const guardianTargetItemId = toText(activePrompt?.itemId);

  return (
    <div className={["approval-dock", className].filter(Boolean).join(" ")} role="region" aria-label="审批">
      <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <span className="attn-dot" aria-hidden="true" />
          <div className="text-[12px] font-semibold tracking-[0.2px] text-[color:var(--text)]">审批</div>
        </div>
        <span className="mono dim text-[11px]">{approvalStore.queue.length || 0}</span>
      </div>

      <div id="approval-box" className={activePrompt ? "" : "dim"}>
        {!activePrompt ? (
          <div className="grid gap-2">
            <div>当前无待审批请求</div>
            <GuardianReviewDiagnostics threadId={guardianThreadId} focusTargetItemId={guardianTargetItemId} maxItems={4} />
          </div>
        ) : (
          <div className="user-input-card approval-dock-card">
            {approvalStore.queue.length > 1 ? (
              <div className="approval-dock-queue">
                {approvalStore.queue.slice(0, 8).map((prompt) => {
                  const isActive = promptKey(prompt) === promptKey(activePrompt);
                  return (
                    <button
                      key={promptKey(prompt)}
                      type="button"
                      className={`btn-mini approval-dock-queue-item${isActive ? " is-active" : ""}`}
                      onClick={() => approvalStore.setActive(prompt.serverId, prompt.requestId)}
                    >
                      <span className="mono dim">{promptAge(prompt)}</span>
                      <span className="truncate">{headerText(prompt)}</span>
                      <span className="mono dim truncate">· {queueItemMetaText(prompt)}</span>
                    </button>
                  );
                })}
                {approvalStore.queue.length > 8 ? (
                  <div className="mono dim text-[11px]">
                    还有 {approvalStore.queue.length - 8} 条未显示
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="user-input-head">
              <div className="user-input-header">{headerText(activePrompt)}</div>
              <div className="user-input-progress mono dim">{metaText(activePrompt)}</div>
            </div>

            {detailRows(activePrompt).length > 0 ? (
              <div className="grid gap-1.5">
                {detailRows(activePrompt).map((row) => (
                  <div key={row.label} className="user-input-question mono">
                    <span className="dim">{row.label}：</span>
                    {row.value}
                  </div>
                ))}
              </div>
            ) : null}

            {detailText(activePrompt) ? <pre className="approval-dock-detail mono">{detailText(activePrompt)}</pre> : null}

            <GuardianReviewDiagnostics threadId={guardianThreadId} focusTargetItemId={guardianTargetItemId} maxItems={4} />

            <div className="user-input-actions approval-dock-actions">
              {activePrompt.kind === "fileChange" ? (
                <>
                  <button type="button" onClick={() => void runtime.submitActiveApprovalPrompt("decline")}>
                    拒绝
                  </button>
                  <button className="danger" type="button" onClick={() => void runtime.submitActiveApprovalPrompt("cancel")}>
                    拒绝并中断
                  </button>
                  <button type="button" onClick={() => void runtime.submitActiveApprovalPrompt("acceptForSession")}>
                    本会话允许
                  </button>
                  <button type="button" onClick={() => void runtime.submitActiveApprovalPrompt("accept")}>
                    允许
                  </button>
                </>
              ) : null}
              {activePrompt.kind === "commandExecution"
                ? commandDecisionButtons(activePrompt).map((button) => (
                    <button
                      key={button.key}
                      className={button.kind === "danger" ? "danger" : ""}
                      type="button"
                      onClick={() => void runtime.submitActiveApprovalPrompt(button.decision)}
                    >
                      {button.label}
                    </button>
                  ))
                : null}
              {activePrompt.kind === "permissions" ? (
                <>
                  <button type="button" onClick={() => void runtime.submitActiveApprovalPrompt("decline")}>
                    拒绝
                  </button>
                  <button className="danger" type="button" onClick={() => void runtime.submitActiveApprovalPrompt("cancel")}>
                    拒绝并关闭
                  </button>
                  <button type="button" onClick={() => void runtime.submitActiveApprovalPrompt("session")}>
                    本会话允许
                  </button>
                  <button type="button" onClick={() => void runtime.submitActiveApprovalPrompt("turn")}>
                    仅本轮允许
                  </button>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
