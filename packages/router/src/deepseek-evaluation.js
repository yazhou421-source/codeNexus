// Opt-in DeepSeek acceptance helpers. Not selected by the Provider Registry.
import { requireApiKey } from "./config.js";
import { fetchInitWithProxy } from "./proxy.js";
import { ProductError, safeProductError } from "./product-errors.js";

export function reconcileDeepSeekModels(definitions, liveModels) {
  const ids = new Set(liveModels.map((model) => model.id));
  const upstreamIds = new Set(definitions.map((model) => model.upstreamModel));
  return {
    available: definitions
      .filter((m) => ids.has(m.upstreamModel))
      .map((m) => ({ id: m.id, upstreamModel: m.upstreamModel })),
    notReturned: definitions
      .filter((m) => !ids.has(m.upstreamModel))
      .map((m) => ({ id: m.id, upstreamModel: m.upstreamModel })),
    unregistered: [...ids].filter((id) => !upstreamIds.has(id)),
  };
}

export async function fetchDeepSeekModels(
  route,
  { resolveSecret, fetchImpl = fetch, timeoutMs = 15_000 } = {},
) {
  const queriedAt = new Date().toISOString();
  let status = null;
  try {
    if (
      route.apiKeyRef !== "deepseek" ||
      new URL(route.baseUrl).origin !== "https://api.deepseek.com"
    ) {
      throw new ProductError("PROVIDER_NOT_CONFIGURED");
    }
    const response = await fetchImpl(
      "https://api.deepseek.com/v1/models",
      fetchInitWithProxy("https://api.deepseek.com/v1/models", {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${requireApiKey(route, resolveSecret)}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      }),
    );
    status = response.status;
    if (!response.ok) {
      // Mapping consumes the provider body in main only; the return value is an allowlist.
      throw { statusCode: status, bodyText: await response.text() };
    }
    const body = await response.json();
    if (
      !Array.isArray(body?.data) ||
      body.data.some((m) => !safeModelId(m?.id))
    ) {
      throw new ProductError("INVALID_RESPONSE");
    }
    const models = body.data.map((m) => ({
      id: m.id,
      object: m.object === "model" ? "model" : "unknown",
      owned_by: m.owned_by === "deepseek" ? "deepseek" : "unknown",
    }));
    return { queriedAt, ok: true, status, errorCode: null, models };
  } catch (error) {
    const code =
      error?.name === "TimeoutError"
        ? "TIMEOUT"
        : error instanceof TypeError
          ? "NETWORK_ERROR"
          : safeProductError(error, route).code;
    return { queriedAt, ok: false, status, errorCode: code, models: [] };
  }
}

function safeModelId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{1,120}$/.test(value);
}
