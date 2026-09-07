import { createHash } from "node:crypto";
import { redactSensitiveText } from "./redaction.js";

const SAFE_MESSAGES = new Set([
  "The `reasoning_content` in the thinking mode must be passed back to the API.",
]);

// Never persist arbitrary provider bodies: they may echo prompts or file text.
export function upstreamDiagnostic(requestId, route, error, secrets = []) {
  if (
    !Number.isInteger(error?.statusCode) ||
    typeof error.bodyText !== "string"
  )
    return null;
  let detail;
  try {
    detail = JSON.parse(error.bodyText)?.error;
  } catch {
    /* Non-JSON bodies are not diagnostic text. */
  }
  const identifier = (value) =>
    typeof value === "string" && /^[a-zA-Z0-9_.[\]-]{1,100}$/.test(value)
      ? redactSensitiveText(value, secrets)
      : null;
  const message = typeof detail?.message === "string" ? detail.message : "";
  return {
    timestamp: new Date().toISOString(),
    requestId: identifier(requestId),
    route: identifier(route.id),
    status: error.statusCode,
    code: identifier(detail?.code),
    type: identifier(detail?.type),
    param: identifier(detail?.param),
    message: SAFE_MESSAGES.has(message)
      ? message
      : "[REDACTED] unrecognized provider message",
    messageHash: createHash("sha256").update(message).digest("hex"),
  };
}
