import { joinUpstreamUrl } from "./config.js";
import { responsesToChatRequest } from "./responses-to-chat.js";
import { callJsonUpstream, UpstreamHttpError } from "./upstream.js";

export async function testProviderConnection(
  route,
  { resolveSecret, timeoutMs = 15_000 } = {},
) {
  const startedAt = Date.now();
  const converted = responsesToChatRequest(
    {
      model: route.id,
      input: "Reply with OK.",
      max_output_tokens: 1,
      stream: false,
    },
    route,
    null,
  );
  const upstreamUrl = joinUpstreamUrl(route.baseUrl, "/chat/completions");
  const response = await callJsonUpstream(
    upstreamUrl,
    route,
    converted.body,
    { resolveSecret, requestId: "provider-test" },
    { timeoutMs, cacheFailures: false, trackRateLimit: false },
  );
  if (!Array.isArray(response?.choices)) {
    throw new UpstreamHttpError(
      502,
      "Provider returned an invalid chat response",
      upstreamUrl,
      route,
    );
  }
  return {
    ok: true,
    providerId: route.provider || route.providerId || "",
    modelId: route.id,
    elapsedMs: Math.max(0, Date.now() - startedAt),
  };
}
