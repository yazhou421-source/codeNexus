import type {
  CodexServerNotificationMethod as OfficialServerNotificationMethod,
  CodexServerRequestMethod as OfficialServerRequestMethod,
} from "@codenexus/shared/codex-protocol";

export type { OfficialServerRequestMethod };
export type UnsupportedLegacyServerRequestMethod = "applyPatchApproval" | "execCommandApproval";
export type UnsupportedDeprecatedServerNotificationMethod =
  | "item/fileChange/outputDelta"
  | "thread/compacted"
  | "fuzzyFileSearch/sessionUpdated"
  | "fuzzyFileSearch/sessionCompleted";
export type ServerRequestMethod = Exclude<OfficialServerRequestMethod, UnsupportedLegacyServerRequestMethod>;
export type ServerNotificationMethod = Exclude<
  OfficialServerNotificationMethod,
  UnsupportedDeprecatedServerNotificationMethod
>;

type AssertNever<T extends never> = T;

export const SERVER_REQUEST_METHODS: readonly ServerRequestMethod[] = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
  "item/tool/call",
  "account/chatgptAuthTokens/refresh",
  "attestation/generate",
  "currentTime/read",
];

export const SERVER_NOTIFICATION_METHODS: readonly ServerNotificationMethod[] = [
  "error",
  "thread/started",
  "thread/status/changed",
  "thread/archived",
  "thread/unarchived",
  "thread/closed",
  "skills/changed",
  "thread/name/updated",
  "thread/goal/updated",
  "thread/goal/cleared",
  "thread/tokenUsage/updated",
  "turn/started",
  "hook/started",
  "turn/completed",
  "hook/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "item/started",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "item/completed",
  "rawResponseItem/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "command/exec/outputDelta",
  "process/outputDelta",
  "process/exited",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/patchUpdated",
  "serverRequest/resolved",
  "item/mcpToolCall/progress",
  "mcpServer/oauthLogin/completed",
  "mcpServer/startupStatus/updated",
  "account/updated",
  "account/rateLimits/updated",
  "app/list/updated",
  "remoteControl/status/changed",
  "externalAgentConfig/import/completed",
  "fs/changed",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "model/rerouted",
  "model/verification",
  "warning",
  "guardianWarning",
  "deprecationNotice",
  "configWarning",
  "thread/realtime/started",
  "thread/realtime/itemAdded",
  "thread/realtime/transcript/delta",
  "thread/realtime/transcript/done",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/sdp",
  "thread/realtime/error",
  "thread/realtime/closed",
  "windows/worldWritableWarning",
  "windowsSandbox/setupCompleted",
  "account/login/completed",
  "autoApprovalReview/strictReviewRequired",
  "externalAgentConfig/import/progress",
  "mcpServer/event/stream/notification",
  "model/safetyBuffering/updated",
  "modelProvider/authRecoveryCompleted",
  "modelProvider/authRecoveryStarted",
  "project/changed",
  "rawResponse/completed",
  "thread/deleted",
  "thread/environment/connected",
  "thread/environment/disconnected",
  "thread/project/updated",
  "thread/queue/changed",
  "thread/realtime/item/completed",
  "thread/realtime/item/started",
  "thread/realtime/item/transcript/delta",
  "thread/reverted",
  "turn/moderationMetadata",
];

type MissingServerRequestMethods = Exclude<ServerRequestMethod, (typeof SERVER_REQUEST_METHODS)[number]>;
type ExtraServerRequestMethods = Exclude<(typeof SERVER_REQUEST_METHODS)[number], ServerRequestMethod>;
type UnknownUnsupportedLegacyServerRequestMethods = Exclude<
  UnsupportedLegacyServerRequestMethod,
  OfficialServerRequestMethod
>;
type UnknownUnsupportedDeprecatedServerNotificationMethods = Exclude<
  UnsupportedDeprecatedServerNotificationMethod,
  OfficialServerNotificationMethod
>;
type MissingServerNotificationMethods = Exclude<ServerNotificationMethod, (typeof SERVER_NOTIFICATION_METHODS)[number]>;
type ExtraServerNotificationMethods = Exclude<(typeof SERVER_NOTIFICATION_METHODS)[number], ServerNotificationMethod>;

type _AssertNoMissingServerRequestMethods = AssertNever<MissingServerRequestMethods>;
type _AssertNoExtraServerRequestMethods = AssertNever<ExtraServerRequestMethods>;
type _AssertNoUnknownUnsupportedLegacyServerRequestMethods = AssertNever<UnknownUnsupportedLegacyServerRequestMethods>;
type _AssertNoUnknownUnsupportedDeprecatedServerNotificationMethods =
  AssertNever<UnknownUnsupportedDeprecatedServerNotificationMethods>;
type _AssertNoMissingServerNotificationMethods = AssertNever<MissingServerNotificationMethods>;
type _AssertNoExtraServerNotificationMethods = AssertNever<ExtraServerNotificationMethods>;

const SERVER_REQUEST_METHOD_SET = new Set<string>(SERVER_REQUEST_METHODS);
const SERVER_NOTIFICATION_METHOD_SET = new Set<string>(SERVER_NOTIFICATION_METHODS);

export function isServerRequestMethod(method: string): method is ServerRequestMethod {
  return SERVER_REQUEST_METHOD_SET.has(method);
}

export function isServerNotificationMethod(method: string): method is ServerNotificationMethod {
  return SERVER_NOTIFICATION_METHOD_SET.has(method);
}
