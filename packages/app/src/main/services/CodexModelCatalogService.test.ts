import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));
import type { CodexAppServer } from "../codexAppServer";
import { CodexModelCatalogService } from "./CodexModelCatalogService";

function harness(pages: object[], loggedIn = true) {
  const request = vi.fn(async (method: string) =>
    method === "account/read" ? { account: loggedIn ? { type: "chatgpt" } : null } : pages.shift()
  );
  const server = { start: vi.fn(), stop: vi.fn(), request };
  const create = vi.fn(() => server as unknown as CodexAppServer);
  return { service: new CodexModelCatalogService(create), server, create };
}
describe("signed-in Codex model catalog", () => {
  it("keeps Astra when returned, excludes hidden entries and consumes every page", async () => {
    const h = harness([
      {
        data: [
          { model: "gpt-6-astra", hidden: false },
          { model: "private", hidden: true },
        ],
        nextCursor: "page2",
      },
      { data: [{ model: "gpt-5.5", hidden: false }], nextCursor: null },
    ]);
    expect((await h.service.list()).map((model) => model.model)).toEqual(["gpt-6-astra", "gpt-5.5"]);
    expect(h.server.request).toHaveBeenCalledWith("model/list", { cursor: "page2", limit: 200, includeHidden: false });
    expect(h.server.stop).toHaveBeenCalledOnce();
  });
  it("does not invent Astra if the account does not return it", async () => {
    const h = harness([{ data: [{ model: "gpt-5.5" }], nextCursor: null }]);
    expect((await h.service.list()).map((model) => model.model)).toEqual(["gpt-5.5"]);
  });
  it("returns no Codex choices while logged out, without querying model/list", async () => {
    const h = harness([], false);
    expect(await h.service.list()).toEqual([]);
    expect(h.server.request).toHaveBeenCalledTimes(1);
  });
  it("deduplicates concurrent discovery and fails closed on invalid pagination", async () => {
    const h = harness([
      { data: [], nextCursor: "same" },
      { data: [], nextCursor: "same" },
    ]);
    const result = await Promise.allSettled([h.service.list(), h.service.list()]);
    expect(result.every((entry) => entry.status === "rejected")).toBe(true);
    expect(h.create).toHaveBeenCalledOnce();
    expect(h.server.stop).toHaveBeenCalledOnce();
  });
});
