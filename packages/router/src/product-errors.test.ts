import { describe, expect, it } from "vitest";
import { ProductErrorCode, safeProductError } from "./product-errors.js";

const route = {
  id: "synthetic-model",
  provider: "synthetic-provider",
  displayName: "Synthetic",
  model: "synthetic-upstream",
  api: "chat_completions",
};

describe("product-safe provider errors", () => {
  it.each([
    [401, {}, ProductErrorCode.INVALID_API_KEY],
    [403, {}, ProductErrorCode.INVALID_API_KEY],
    [402, {}, ProductErrorCode.INSUFFICIENT_BALANCE],
    [
      429,
      { error: { code: "insufficient_quota" } },
      ProductErrorCode.INSUFFICIENT_BALANCE,
    ],
    [
      429,
      { error: { code: "rate_limit_reached_error" } },
      ProductErrorCode.RATE_LIMITED,
    ],
    [404, {}, ProductErrorCode.MODEL_UNAVAILABLE],
    [500, {}, ProductErrorCode.PROVIDER_UNAVAILABLE],
    [503, {}, ProductErrorCode.PROVIDER_UNAVAILABLE],
    [400, {}, ProductErrorCode.INVALID_RESPONSE],
    [422, {}, ProductErrorCode.INVALID_RESPONSE],
  ])(
    "maps HTTP %i to %s without returning raw upstream content",
    (status, body, expected) => {
      const secret = "synthetic-sensitive-value";
      const error = {
        statusCode: status,
        bodyText: JSON.stringify({ ...body, message: secret }),
        upstreamUrl: "https://provider.example/v1/chat/completions",
        route,
      };

      const safe = safeProductError(error, route);

      expect(safe.code).toBe(expected);
      expect(JSON.stringify(safe)).not.toContain(secret);
      expect(JSON.stringify(safe)).not.toContain("provider.example");
    },
  );

  it("maps network failures without exposing URLs", () => {
    const error = {
      code: "upstream_network_error",
      message: "connect ECONNREFUSED sensitive-host",
      upstreamUrl: "https://sensitive-host.example/v1",
      route,
    };
    const safe = safeProductError(error, route);
    expect(safe.code).toBe(ProductErrorCode.NETWORK_ERROR);
    expect(JSON.stringify(safe)).not.toContain("sensitive-host");
  });

  it("maps provider timeouts", () => {
    const error = { code: "upstream_timeout", statusCode: 504, route };
    expect(safeProductError(error, route).code).toBe(ProductErrorCode.TIMEOUT);
  });
});
