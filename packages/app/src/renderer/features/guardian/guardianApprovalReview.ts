import type { TimelineEventItem, TimelineEventLevel } from "../../domain/types";
import type { AutoReviewDecisionSource } from "@codenexus/generated/codex-app-server/v2/AutoReviewDecisionSource";
import type { GuardianApprovalReviewStatus } from "@codenexus/generated/codex-app-server/v2/GuardianApprovalReviewStatus";
import type { GuardianRiskLevel } from "@codenexus/generated/codex-app-server/v2/GuardianRiskLevel";
import type { GuardianUserAuthorization } from "@codenexus/generated/codex-app-server/v2/GuardianUserAuthorization";

const SUMMARY_SEPARATOR = " ｜ ";

export type GuardianApprovalReviewMethod = "item/autoApprovalReview/started" | "item/autoApprovalReview/completed";

export type GuardianApprovalReviewTone = "neutral" | "running" | "ok" | "warn" | "error";
export type GuardianApprovalReviewLifecycle = "started" | "completed";
export type GuardianApprovalReviewDisplayStatus = GuardianApprovalReviewStatus | "unknown";

export type GuardianApprovalReviewActivity = {
  lifecycle: GuardianApprovalReviewLifecycle;
  reviewId: string;
  targetItemId: string | null;
  status: GuardianApprovalReviewDisplayStatus;
  riskLevel: GuardianRiskLevel | null;
  userAuthorization: GuardianUserAuthorization | null;
  rationale: string | null;
  decisionSource: AutoReviewDecisionSource | null;
  actionType: string;
  actionSummary: string;
  summaryText: string;
  tone: GuardianApprovalReviewTone;
  level: TimelineEventLevel;
};

export type GuardianApprovalReviewDiagnosticItem = GuardianApprovalReviewActivity & {
  eventId: string;
  createdAt: number;
  statusText: string;
  riskText: string;
  userAuthorizationText: string;
  decisionSourceText: string;
  detailText: string;
  matchesTarget: boolean;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const text = String(value).trim();
  return text ? text : null;
}

function shorten(value: string, maxChars: number): string {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function shortId(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length <= 12 ? text : `…${text.slice(-12)}`;
}

function basenameFromPath(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? text;
}

function shortPath(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const normalized = text.replace(/^\.\\/, "").replace(/^\.\//, "");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  const tail = parts.length <= 2 ? normalized : parts.slice(-2).join("/");
  return shorten(tail, 64);
}

function isGuardianApprovalReviewStatus(value: unknown): value is GuardianApprovalReviewStatus {
  return value === "inProgress" || value === "approved" || value === "denied" || value === "aborted";
}

function isGuardianRiskLevel(value: unknown): value is GuardianRiskLevel {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

function isGuardianUserAuthorization(value: unknown): value is GuardianUserAuthorization {
  return value === "unknown" || value === "low" || value === "medium" || value === "high";
}

function isAutoReviewDecisionSource(value: unknown): value is AutoReviewDecisionSource {
  return value === "agent";
}

function joinSummaryParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(SUMMARY_SEPARATOR);
}

function statusText(status: GuardianApprovalReviewDisplayStatus, lifecycle: GuardianApprovalReviewLifecycle): string {
  if (status === "inProgress") return "复核中";
  if (status === "approved") return "已通过";
  if (status === "denied") return "已拒绝";
  if (status === "aborted") return "已中止";
  return lifecycle === "started" ? "复核中" : "已完成";
}

function riskText(value: GuardianRiskLevel | null): string {
  if (value === "low") return "低";
  if (value === "medium") return "中";
  if (value === "high") return "高";
  if (value === "critical") return "严重";
  return "";
}

function userAuthorizationText(value: GuardianUserAuthorization | null): string {
  if (value === "low") return "低";
  if (value === "medium") return "中";
  if (value === "high") return "高";
  if (value === "unknown") return "未知";
  return "";
}

function decisionSourceText(value: AutoReviewDecisionSource | null): string {
  if (value === "agent") return "agent";
  return "";
}

function actionSummary(actionValue: unknown): { actionType: string; actionSummary: string } {
  const action = toRecord(actionValue);
  const actionType = normalizeOptionalText(action?.type) ?? "unknown";

  if (actionType === "command") {
    const command = normalizeOptionalText(action?.command);
    return {
      actionType,
      actionSummary: command
        ? `命令 ${shorten(command, 96)}`
        : "命令审批",
    };
  }

  if (actionType === "execve") {
    const program = normalizeOptionalText(action?.program);
    const argv = Array.isArray(action?.argv)
      ? action.argv.map((value) => normalizeOptionalText(value)).filter((value): value is string => Boolean(value))
      : [];
    const programLabel = basenameFromPath(program ?? "") || program || "程序";
    const argvPreview = argv
      .slice(0, 2)
      .map((value) => shorten(value, 24))
      .join(" ");
    return {
      actionType,
      actionSummary: shorten(
        `执行 ${programLabel}${argvPreview ? ` ${argvPreview}` : ""}`,
        96
      ),
    };
  }

  if (actionType === "applyPatch") {
    const files = Array.isArray(action?.files)
      ? action.files.map((value) => normalizeOptionalText(value)).filter((value): value is string => Boolean(value))
      : [];
    if (files.length === 0) {
      return { actionType, actionSummary: "补丁变更" };
    }
    const head = shortPath(files[0]);
    const more = files.length > 1 ? ` +${files.length - 1}` : "";
    return {
      actionType,
      actionSummary: `补丁 ${head || "文件"}${more}`,
    };
  }

  if (actionType === "networkAccess") {
    const protocol = normalizeOptionalText(action?.protocol);
    const host = normalizeOptionalText(action?.host);
    const port = normalizeOptionalText(action?.port);
    const target = normalizeOptionalText(action?.target);
    const primary = target || [host, port ? `${host ? ":" : ""}${port}` : ""].filter(Boolean).join("");
    const detail = primary || "网络访问";
    return {
      actionType,
      actionSummary: protocol
        ? `网络 ${detail} (${protocol})`
        : `网络 ${detail}`,
    };
  }

  if (actionType === "mcpToolCall") {
    const server = normalizeOptionalText(action?.server) ?? "unknown";
    const toolTitle = normalizeOptionalText(action?.toolTitle);
    const toolName = normalizeOptionalText(action?.toolName);
    const connectorName = normalizeOptionalText(action?.connectorName);
    const label = toolTitle || toolName || connectorName || "工具";
    return {
      actionType,
      actionSummary: `MCP ${shorten(`${server}/${label}`, 96)}`,
    };
  }

  return {
    actionType,
    actionSummary: "审批动作",
  };
}

function toneFromStatus(
  status: GuardianApprovalReviewDisplayStatus,
  lifecycle: GuardianApprovalReviewLifecycle
): GuardianApprovalReviewTone {
  if (status === "approved") return "ok";
  if (status === "denied" || status === "aborted") return "warn";
  if (status === "inProgress") return "running";
  return lifecycle === "started" ? "running" : "neutral";
}

function levelFromStatus(
  status: GuardianApprovalReviewDisplayStatus,
  lifecycle: GuardianApprovalReviewLifecycle
): TimelineEventLevel {
  if (status === "denied" || status === "aborted") return "warn";
  if (status === "inProgress") return "info";
  return lifecycle === "started" ? "info" : "info";
}

export function isGuardianApprovalReviewMethod(method: unknown): method is GuardianApprovalReviewMethod {
  return method === "item/autoApprovalReview/started" || method === "item/autoApprovalReview/completed";
}

export function guardianApprovalReviewStatusText(
  status: GuardianApprovalReviewDisplayStatus,
  lifecycle: GuardianApprovalReviewLifecycle
): string {
  return statusText(status, lifecycle);
}

export function buildGuardianApprovalReviewEventId(
  threadIdValue: unknown,
  turnIdValue: unknown,
  reviewIdValue: unknown
): string {
  const threadId = normalizeOptionalText(threadIdValue) ?? "__app__";
  const turnId = normalizeOptionalText(turnIdValue) ?? "unknown";
  const reviewId = normalizeOptionalText(reviewIdValue) ?? "unknown";
  return `notif:item/autoApprovalReview:${threadId}:${turnId}:${reviewId}`;
}

export function buildGuardianApprovalReviewActivity(
  method: unknown,
  params: unknown
): GuardianApprovalReviewActivity | null {
  if (!isGuardianApprovalReviewMethod(method)) return null;
  const payload = toRecord(params);
  if (!payload) return null;

  const lifecycle: GuardianApprovalReviewLifecycle =
    method === "item/autoApprovalReview/started" ? "started" : "completed";
  const reviewId = normalizeOptionalText(payload.reviewId);
  if (!reviewId) return null;

  const review = toRecord(payload.review);
  const rawStatus = review?.status;
  const status: GuardianApprovalReviewDisplayStatus = isGuardianApprovalReviewStatus(rawStatus) ? rawStatus : "unknown";
  const riskLevel = isGuardianRiskLevel(review?.riskLevel) ? review.riskLevel : null;
  const userAuthorization = isGuardianUserAuthorization(review?.userAuthorization) ? review.userAuthorization : null;
  const rationale = normalizeOptionalText(review?.rationale);
  const decisionSource = isAutoReviewDecisionSource(payload.decisionSource) ? payload.decisionSource : null;
  const targetItemId = normalizeOptionalText(payload.targetItemId);
  const action = actionSummary(payload.action);

  const title = action.actionSummary
    ? `Guardian ${statusText(status, lifecycle)}：${action.actionSummary}`
    : targetItemId
      ? `Guardian ${statusText(status, lifecycle)}：目标 ${shortId(targetItemId)}`
      : `Guardian ${statusText(status, lifecycle)}`;

  const summaryText = joinSummaryParts([
    title,
    riskLevel ? `风险：${riskText(riskLevel)}` : "",
    lifecycle === "completed" && userAuthorization
      ? `授权：${userAuthorizationText(userAuthorization)}`
      : "",
    lifecycle === "completed" && decisionSource
      ? `来源：${decisionSourceText(decisionSource)}`
      : "",
    lifecycle === "completed" && rationale
      ? `原因：${shorten(rationale, 96)}`
      : "",
  ]);

  return {
    lifecycle,
    reviewId,
    targetItemId,
    status,
    riskLevel,
    userAuthorization,
    rationale,
    decisionSource,
    actionType: action.actionType,
    actionSummary: action.actionSummary,
    summaryText,
    tone: toneFromStatus(status, lifecycle),
    level: levelFromStatus(status, lifecycle),
  };
}

export function extractGuardianApprovalReviewDiagnosticItem(
  event: Pick<TimelineEventItem, "id" | "method" | "params" | "createdAt">,
  focusTargetItemIdValue?: unknown
): GuardianApprovalReviewDiagnosticItem | null {
  const activity = buildGuardianApprovalReviewActivity(event.method, event.params);
  if (!activity) return null;

  const focusTargetItemId = normalizeOptionalText(focusTargetItemIdValue);
  const matchesTarget = Boolean(
    focusTargetItemId && activity.targetItemId && focusTargetItemId === activity.targetItemId
  );

  const statusLabel = guardianApprovalReviewStatusText(activity.status, activity.lifecycle);
  const riskLabel = riskText(activity.riskLevel);
  const userAuthorizationLabel = userAuthorizationText(activity.userAuthorization);
  const decisionSourceLabel = decisionSourceText(activity.decisionSource);
  const detailText = joinSummaryParts([
    `reviewId=${activity.reviewId}`,
    activity.targetItemId ? `targetItemId=${activity.targetItemId}` : "",
    activity.actionSummary ? `action=${activity.actionSummary}` : "",
    riskLabel ? `risk=${riskLabel}` : "",
    userAuthorizationLabel ? `authorization=${userAuthorizationLabel}` : "",
    decisionSourceLabel ? `source=${decisionSourceLabel}` : "",
    activity.rationale ? `rationale=${activity.rationale}` : "",
  ]).replace(new RegExp(SUMMARY_SEPARATOR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "\n");

  return {
    ...activity,
    eventId: String(event.id ?? "").trim(),
    createdAt: Number.isFinite(event.createdAt) ? Number(event.createdAt) : Date.now(),
    statusText: statusLabel,
    riskText: riskLabel,
    userAuthorizationText: userAuthorizationLabel,
    decisionSourceText: decisionSourceLabel,
    detailText,
    matchesTarget,
  };
}

export function collectGuardianApprovalReviewDiagnosticItems(
  events: TimelineEventItem[],
  options?: {
    focusTargetItemId?: unknown;
    maxItems?: number;
  }
): GuardianApprovalReviewDiagnosticItem[] {
  const itemsByReviewId = new Map<string, GuardianApprovalReviewDiagnosticItem>();
  const focusTargetItemId = options?.focusTargetItemId;
  const maxItems = Number.isFinite(options?.maxItems) ? Math.max(1, Math.round(options!.maxItems!)) : 5;

  for (const event of Array.isArray(events) ? events : []) {
    const item = extractGuardianApprovalReviewDiagnosticItem(event, focusTargetItemId);
    if (!item) continue;
    itemsByReviewId.set(item.reviewId, item);
  }

  return [...itemsByReviewId.values()]
    .sort((left, right) => {
      if (left.matchesTarget !== right.matchesTarget) return left.matchesTarget ? -1 : 1;
      if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt;
      return right.reviewId.localeCompare(left.reviewId);
    })
    .slice(0, maxItems);
}
