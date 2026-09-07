import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
const api = vi.hoisted(() => ({ readAccount: vi.fn(), startChatGptLogin: vi.fn(), cancelChatGptLogin: vi.fn() }));
vi.mock("../api/codexDesktopClient", () => ({ codexDesktop: { app: api } }));
import { useAccountStatusStore } from "./accountStatus.store";
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
});
describe("visible authentication status", () => {
  it.each(["logged_in", "logged_out", "expired"])("displays verified %s without a model call", async (state) => {
    api.readAccount.mockResolvedValue({ state, email: null, planType: null, requiresOpenaiAuth: true });
    const store = useAccountStatusStore();
    await store.refresh();
    expect(store.status).toBe(state);
    expect(store.busy).toBe(false);
  });
  it("clears a stale logged-in label when the network cannot verify it", async () => {
    const store = useAccountStatusStore();
    api.readAccount
      .mockResolvedValueOnce({ state: "logged_in", email: "test@example.com" })
      .mockRejectedValueOnce(new Error("offline"));
    await store.refresh();
    await store.refresh();
    expect(store.status).toBe("unknown");
    expect(store.account).toBeNull();
  });
  it("does not announce login success before verification", async () => {
    const store = useAccountStatusStore();
    await store.login();
    expect(store.status).toBe("logging_in");
    api.readAccount.mockResolvedValue({ state: "expired" });
    await store.loginCompleted(true);
    expect(store.status).toBe("expired");
  });
  it("deduplicates concurrent reads", async () => {
    api.readAccount.mockResolvedValue({ state: "logged_out" });
    const store = useAccountStatusStore();
    await Promise.all([store.refresh(), store.refresh()]);
    expect(api.readAccount).toHaveBeenCalledTimes(1);
  });
});
