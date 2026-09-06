import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ listAccountModels: vi.fn() }));
vi.mock("../api/codexDesktopClient", () => ({ codexDesktop: { codexServer: api, localState: {}, app: {} } }));
import { useModelCatalogStore } from "./modelCatalog.store";
import { useRuntimeStore } from "./runtime.store";

const catalog = (...ids: string[]) => ({ data: ids.map((model) => ({ model })), nextCursor: null });
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  useModelCatalogStore().cancelRetry();
  vi.useRealTimers();
});
describe("dynamic account model choices", () => {
  it("includes returned Astra and omits hidden and unreturned models", async () => {
    api.listAccountModels.mockResolvedValue({
      data: [{ model: "gpt-6-astra" }, { model: "gpt-reserve", hidden: true }],
      nextCursor: null,
    });
    const store = useModelCatalogStore();
    await store.refreshRemoteModels();
    expect(store.availableModelIds).toEqual(["gpt-6-astra"]);
    expect(store.isRemoteModelUnavailable("gpt-5.5")).toBe(true);
  });
  it("keeps last successful account choices after a temporary failure", async () => {
    const store = useModelCatalogStore();
    api.listAccountModels.mockResolvedValueOnce(catalog("gpt-6-astra")).mockRejectedValue(new Error("offline"));
    await store.refreshRemoteModels();
    await store.refreshRemoteModels();
    expect(store.availableModelIds).toEqual(["gpt-6-astra"]);
    expect(store.isRemoteModelUnavailable("gpt-6-astra")).toBe(false);
    expect(store.remoteLoadState).toBe("error");
    expect(store.remoteErrorText).toContain("retry");
  });
  it("loads the account catalog before a workspace exists", async () => {
    expect(useRuntimeStore().serverId).toBeFalsy();
    api.listAccountModels.mockResolvedValue(catalog("gpt-6-astra"));
    const store = useModelCatalogStore();
    await store.ensureRemoteModels();
    expect(store.availableModelIds).toEqual(["gpt-6-astra"]);
  });
  it("does not treat a workspace switch as an account change", async () => {
    api.listAccountModels.mockImplementation(async () => {
      useRuntimeStore().serverId = "server2";
      return catalog("gpt-6-astra");
    });
    const store = useModelCatalogStore();
    await store.refreshRemoteModels();
    await store.ensureRemoteModels();
    expect(store.availableModelIds).toEqual(["gpt-6-astra"]);
    expect(api.listAccountModels).toHaveBeenCalledOnce();
  });
  it("automatically loads after unknown -> logged_in and after login recovery", async () => {
    const store = useModelCatalogStore();
    api.listAccountModels.mockResolvedValue(catalog("gpt-6-astra"));
    await store.accountStatusChanged("unknown");
    await store.accountStatusChanged("checking");
    expect(api.listAccountModels).not.toHaveBeenCalled();
    await store.accountStatusChanged("logged_in");
    expect(store.remoteIds).toEqual(["gpt-6-astra"]);
    await store.accountStatusChanged("logged_out");
    expect(store.remoteIds).toEqual([]);
    await store.accountStatusChanged("logged_in");
    expect(store.remoteIds).toEqual(["gpt-6-astra"]);
    expect(api.listAccountModels).toHaveBeenCalledTimes(2);
  });
  it("ignores late results from before logout", async () => {
    let resolve!: (value: ReturnType<typeof catalog>) => void;
    api.listAccountModels.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const store = useModelCatalogStore();
    const request = store.refreshRemoteModels();
    await store.accountStatusChanged("logged_out");
    resolve(catalog("gpt-6-astra"));
    await request;
    expect(store.remoteIds).toEqual([]);
    expect(store.isRemoteModelUnavailable("gpt-6-astra")).toBe(true);
  });
  it("retries an initial failure and stops retrying after recovery", async () => {
    api.listAccountModels.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(catalog("gpt-6-astra"));
    const store = useModelCatalogStore();
    await store.refreshRemoteModels();
    expect(store.isRemoteModelUnavailable("gpt-5.5")).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.remoteIds).toEqual(["gpt-6-astra"]);
    expect(store.retryTimer).toBeNull();
    expect(store.remoteLoadState).toBe("ready");
  });
  it("bounds automatic retries and allows a later explicit refresh", async () => {
    api.listAccountModels.mockRejectedValue(new Error("offline"));
    const store = useModelCatalogStore();
    await store.refreshRemoteModels();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.listAccountModels).toHaveBeenCalledTimes(4);
    expect(store.retryTimer).toBeNull();
    api.listAccountModels.mockResolvedValue(catalog("gpt-6-astra"));
    await store.refreshRemoteModels();
    expect(store.remoteIds).toEqual(["gpt-6-astra"]);
  });
  it("replaces old choices only on an authoritative successful catalog", async () => {
    api.listAccountModels
      .mockResolvedValueOnce(catalog("gpt-6-astra", "gpt-5.5"))
      .mockResolvedValue(catalog("gpt-6-astra"));
    const store = useModelCatalogStore();
    await store.refreshRemoteModels();
    await store.refreshRemoteModels();
    expect(store.isRemoteModelUnavailable("gpt-5.5")).toBe(true);
    expect(store.remoteIds).toEqual(["gpt-6-astra"]);
  });
  it("rejects incomplete results without replacing the successful catalog", async () => {
    api.listAccountModels
      .mockResolvedValueOnce(catalog("gpt-6-astra"))
      .mockResolvedValue({ data: [], nextCursor: "more" });
    const store = useModelCatalogStore();
    await store.refreshRemoteModels();
    await store.refreshRemoteModels();
    expect(store.remoteIds).toEqual(["gpt-6-astra"]);
    expect(store.remoteLoadState).toBe("error");
  });
});
