import { describe, expect, it } from "vitest";
import {
  externalRouterConfigAllowed,
  routerStartAcquired,
  shouldStopEmbeddedRouterOnWindowClose,
  startEmbeddedRouterFailSoft,
} from "./embeddedRouterLifecycle";

describe("embedded Router process lifecycle policy", () => {
  it("allows external Router configuration only in unpackaged development", () => {
    expect(externalRouterConfigAllowed({ isDev: true, isPackaged: false })).toBe(true);
    expect(externalRouterConfigAllowed({ isDev: false, isPackaged: false })).toBe(false);
    expect(externalRouterConfigAllowed({ isDev: true, isPackaged: true })).toBe(false);
  });

  it("keeps the Router alive when only the macOS window closes", () => {
    expect(shouldStopEmbeddedRouterOnWindowClose("darwin")).toBe(false);
    expect(shouldStopEmbeddedRouterOnWindowClose("win32")).toBe(true);
    expect(shouldStopEmbeddedRouterOnWindowClose("linux")).toBe(true);
  });

  it("does not treat another compatible process as an owned Router", () => {
    expect(routerStartAcquired("started")).toBe(true);
    expect(routerStartAcquired("already-running")).toBe(true);
    expect(routerStartAcquired("compatible-router-present")).toBe(false);
    expect(routerStartAcquired("foreign-port-in-use")).toBe(false);
  });

  it("keeps app bootstrap fail-soft when Router startup throws", async () => {
    const warnings: string[] = [];
    const failure = new Error("bind failed");
    const result = await startEmbeddedRouterFailSoft({
      resolveConfig: () => ({
        source: "test",
        config: {
          host: "127.0.0.1",
          port: 15722,
          models: [
            {
              id: "test-model",
              displayName: "Test Model",
              api: "responses",
              baseUrl: "https://api.example.test/v1",
              model: "test-model",
            },
          ],
        },
      }),
      start: async () => {
        throw failure;
      },
      info: () => undefined,
      warn: (message, error) => {
        warnings.push(`${message}: ${String(error)}`);
      },
    });

    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("continuing without the embedded Router");
  });
});
