import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  fetchDeepSeekModels,
  reconcileDeepSeekModels,
} from "./deepseek-evaluation.js";

const route = {
  id: "deepseek-v4-flash",
  model: "deepseek-v4-flash",
  baseUrl: "https://api.deepseek.com/v1",
  apiKeyRef: "deepseek",
  authMode: "api_key",
};
describe("opt-in DeepSeek models evaluation", () => {
  it("returns only model metadata and reconciles upstream aliases", async () => {
    const credential = randomUUID();
    const result = await fetchDeepSeekModels(route, {
      resolveSecret: () => credential,
      fetchImpl: vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "deepseek-reasoner",
              object: "model",
              owned_by: "deepseek",
              private_field: "do not return",
            },
            { id: "new-model", object: "model", owned_by: "deepseek" },
          ],
          account: "private",
        }),
      ),
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private|synthetic|authorization/i,
    );
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(
      reconcileDeepSeekModels(
        [
          { id: "deepseek-r1", upstreamModel: "deepseek-reasoner" },
          { id: "deepseek-v4-pro", upstreamModel: "deepseek-v4-pro" },
        ],
        result.models,
      ),
    ).toEqual({
      available: [{ id: "deepseek-r1", upstreamModel: "deepseek-reasoner" }],
      notReturned: [
        { id: "deepseek-v4-pro", upstreamModel: "deepseek-v4-pro" },
      ],
      unregistered: ["new-model"],
    });
  });
  it.each([
    [401, "INVALID_API_KEY"],
    [402, "INSUFFICIENT_BALANCE"],
    [429, "RATE_LIMITED"],
    [404, "MODEL_UNAVAILABLE"],
  ])("maps %s without returning raw bodies", async (status, code) => {
    const credential = randomUUID();
    const result = await fetchDeepSeekModels(route, {
      resolveSecret: () => credential,
      fetchImpl: async () =>
        new Response("private headers URL and body", {
          status: Number(status),
        }),
    });
    expect(result).toMatchObject({ ok: false, errorCode: code, models: [] });
    expect(JSON.stringify(result)).not.toMatch(/private|synthetic|https/i);
    expect(JSON.stringify(result)).not.toContain(credential);
  });
  it("rejects redirected credential destinations before secret resolution", async () => {
    const resolveSecret = vi.fn();
    expect(
      await fetchDeepSeekModels(
        { ...route, baseUrl: "https://attacker.example" },
        { resolveSecret },
      ),
    ).toMatchObject({ ok: false });
    expect(resolveSecret).not.toHaveBeenCalled();
  });
});
