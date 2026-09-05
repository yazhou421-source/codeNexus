import { beforeEach, describe, expect, it, vi } from "vitest";
const { activate } = vi.hoisted(() => ({ activate: vi.fn() }));
vi.mock("../../api/codexDesktopClient", () => ({ codexDesktop: { workspace: { activate } } }));
vi.mock("../../shared/debugLog", () => ({ appendDebugLog: vi.fn() }));
import { createWorkspaceSessionRuntime } from "./workspaceSessionRuntime";
import { createThreadSwitchRuntime } from "./threadSwitchRuntime";

beforeEach(() => {
  activate.mockReset().mockResolvedValue({ ok: false });
});
function setup() {
  const deps: any = {
    appTimelineId: "app",
    runtimeStore: { workspacePath: "/old", setWorkspace: vi.fn(), setCurrentThread: vi.fn(), clearServer: vi.fn() },
    threadStore: { runningThreadIds: new Set(), setWorkspace: vi.fn(), setCurrentThread: vi.fn() },
    timelineStore: { eventsForThread: () => [] },
    workspaceFilesStore: { confirmResetDirtyTabsForWorkspaceChange: vi.fn(async () => true), ensureReady: vi.fn() },
    appShellStore: { setServerConnState: vi.fn() },
    normalizeWorkspacePath: (s: string) => s,
    findThreadListItem: () => ({ cwd: "/next" }),
    getWorkspaceForThread: () => "/next",
    resetSidePanelStores: vi.fn(),
    pushEvent: vi.fn(),
    translate: (s: string) => s,
    showToast: vi.fn(),
  };
  return deps;
}
describe("renderer workspace authorization transitions", () => {
  it.each(["workspace", "history"])("preserves the old %s selection when native access is cancelled", async (mode) => {
    const deps = setup();
    if (mode === "workspace")
      expect(await createWorkspaceSessionRuntime(deps).applyWorkspaceSelection("/next")).toBe(false);
    else await createThreadSwitchRuntime(deps).switchThread("history");
    expect(activate).toHaveBeenCalledWith({ cwd: "/next" });
    expect(deps.runtimeStore.setWorkspace).not.toHaveBeenCalled();
    expect(deps.runtimeStore.setCurrentThread).not.toHaveBeenCalled();
    expect(deps.threadStore.setWorkspace).not.toHaveBeenCalled();
  });
  it.each(["workspace", "history"])(
    "does not change main authorization when dirty-tab confirmation is cancelled in %s",
    async (mode) => {
      const deps = setup();
      deps.workspaceFilesStore.confirmResetDirtyTabsForWorkspaceChange.mockResolvedValue(false);
      if (mode === "workspace") await createWorkspaceSessionRuntime(deps).applyWorkspaceSelection("/next");
      else await createThreadSwitchRuntime(deps).switchThread("history");
      expect(activate).not.toHaveBeenCalled();
      expect(deps.runtimeStore.setWorkspace).not.toHaveBeenCalled();
    }
  );
  it("requires successful main activation before updating renderer state", async () => {
    const deps = setup();
    activate.mockImplementation(async () => {
      expect(deps.runtimeStore.setWorkspace).not.toHaveBeenCalled();
      return { ok: true };
    });
    expect(await createWorkspaceSessionRuntime(deps).applyWorkspaceSelection("/next")).toBe(true);
    expect(deps.runtimeStore.setWorkspace).toHaveBeenCalledWith("/next");
  });
  it("reports a safe error without replacing state when authorization fails", async () => {
    const deps = setup();
    activate.mockRejectedValue(new Error("internal diagnostic"));
    expect(await createWorkspaceSessionRuntime(deps).applyWorkspaceSelection("/next")).toBe(false);
    expect(deps.showToast).toHaveBeenCalledWith({ kind: "warn", message: "runtime.workspaceAccessDenied" });
    expect(deps.runtimeStore.setWorkspace).not.toHaveBeenCalled();
  });
});
