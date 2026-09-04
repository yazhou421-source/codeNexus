export function responsesToChatRequest(
  request: Record<string, unknown>,
  route: Record<string, unknown>,
  history: unknown,
): {
  body: Record<string, unknown>;
  toolContext: unknown;
  wantsStream: boolean;
  messagesForHistory: unknown[];
};
