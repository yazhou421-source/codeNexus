import type { ServerResponse } from "node:http";
export function streamChatCompletionToResponses(
  upstream: Response,
  res: ServerResponse,
  options: Record<string, unknown>,
): Promise<{
  response: Record<string, unknown>;
  chat: Record<string, unknown>;
}>;
export function consumeSse(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void | Promise<void>,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<void>;
export function writeSse(
  res: ServerResponse,
  event: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<void>;
export function consumeSseBuffer(
  buffer: string,
  onData: (data: string) => void,
): string;
