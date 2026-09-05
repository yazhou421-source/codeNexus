import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  runtime: { workspacePath: "/project" },
  read: vi.fn(),
  git: vi.fn(),
  diff: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("../ui/modal", () => ({ confirmModal: mocks.confirm }));
vi.mock("./runtime.store", () => ({ useRuntimeStore: () => mocks.runtime }));
vi.mock("../domain/runtimeOrchestrator", () => ({
  getRuntimeOrchestrator: () => ({ readWorkspaceDirectory: mocks.read }),
}));
vi.mock("../api/codexDesktopClient", () => ({
  codexDesktop: { workspace: { readGitStatus: mocks.git, readGitDiff: mocks.diff } },
}));
import { useWorkspaceFilesStore } from "./workspaceFiles.store";
beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.runtime.workspacePath = "/project";
  mocks.git.mockResolvedValue({ ok: true, entries: [] });
  mocks.diff.mockResolvedValue({ status: "ok", diffText: "", skipped: 0 });
  mocks.read.mockResolvedValue({ entries: [] });
});
afterEach(() => vi.useRealTimers());
describe("workspace refresh lifecycle", () => {
  it("preserves dirty tabs after confirmation until main authorization and a real workspace change", async () => {
    const s = useWorkspaceFilesStore();
    await s.ensureReady();
    s.editorTabsByPath["/project/a"] = {
      path: "/project/a",
      previewKind: "text",
      draftContent: "unsaved",
      originalContent: "saved",
    } as any;
    s.editorTabOrder = ["/project/a"];
    s.activeEditorTabPath = "/project/a";
    mocks.confirm.mockResolvedValue(true);
    expect(await s.confirmResetDirtyTabsForWorkspaceChange("/other")).toBe(true);
    expect(s.editorTabsByPath["/project/a"].draftContent).toBe("unsaved");
    mocks.runtime.workspacePath = "/other";
    s.syncWorkspace();
    expect(s.editorTabsByPath).toEqual({});
  });
  it("propagates force through openDirectory", async () => {
    const s = useWorkspaceFilesStore();
    await s.ensureReady();
    mocks.read.mockClear();
    await s.ensureReady(true);
    expect(mocks.read).toHaveBeenCalledWith("/project");
  });
  it.each(["create", "modify", "delete", "rename", "mkdir", "rmdir", "failed-command", "cancelled-turn"])(
    "reloads after %s without losing editor draft",
    async () => {
      const s = useWorkspaceFilesStore();
      await s.ensureReady();
      mocks.read.mockClear();
      s.editorTabsByPath["/project/a"] = { draftContent: "unsaved" } as any;
      s.activeEditorTabPath = "/project/a";
      s.scheduleWorkspaceRefresh("/project");
      await vi.advanceTimersByTimeAsync(350);
      expect(mocks.read).toHaveBeenCalledWith("/project");
      expect(s.editorTabsByPath["/project/a"].draftContent).toBe("unsaved");
      expect(s.activeEditorTabPath).toBe("/project/a");
    }
  );
  it("coalesces bursts and ignores another workspace", async () => {
    const s = useWorkspaceFilesStore();
    await s.ensureReady();
    mocks.read.mockClear();
    for (let i = 0; i < 40; i++) s.scheduleWorkspaceRefresh("/project");
    s.scheduleWorkspaceRefresh("/other");
    await vi.advanceTimersByTimeAsync(350);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it("cancels pending work on workspace switch", async () => {
    const s = useWorkspaceFilesStore();
    await s.ensureReady();
    mocks.read.mockClear();
    s.scheduleWorkspaceRefresh("/project");
    mocks.runtime.workspacePath = "/other";
    s.syncWorkspace();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("discards a late directory response after workspace switch", async () => {
    const s = useWorkspaceFilesStore();
    s.syncWorkspace();
    let done!: (v: any) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((r) => {
          done = r;
        })
    );
    const task = s.ensureDirectoryLoaded("/project");
    mocks.runtime.workspacePath = "/other";
    s.syncWorkspace();
    done({ entries: [{ path: "/project/stale" }] });
    await task;
    expect(s.treeEntriesByPath).toEqual({});
  });
  it("never loads outside workspace or noisy expanded directories during automatic refresh", async () => {
    const s = useWorkspaceFilesStore();
    await s.ensureReady();
    mocks.read.mockClear();
    s.expandedDirectoryPaths = [
      "/project/node_modules",
      "/project/.git",
      "/project/dist",
      "/project/release",
      "/elsewhere",
    ];
    s.scheduleWorkspaceRefresh("/project");
    await vi.advanceTimersByTimeAsync(350);
    expect(mocks.read.mock.calls).toEqual([["/project"]]);
    await s.ensureDirectoryLoaded("/elsewhere");
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it("invalidates in-flight refresh results on disposal without changing workspace", async () => {
    const s = useWorkspaceFilesStore();
    s.syncWorkspace();
    let done!: (v: any) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((r) => {
          done = r;
        })
    );
    const task = s.ensureDirectoryLoaded("/project");
    s.cancelWorkspaceRefresh();
    done({ entries: [{ path: "/project/stale" }] });
    await task;
    expect(s.treeEntriesByPath).toEqual({});
  });
  it("does not restore the old current directory after a delayed open finishes", async () => {
    const s = useWorkspaceFilesStore();
    s.syncWorkspace();
    let done!: (v: any) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((r) => {
          done = r;
        })
    );
    const task = s.openDirectory("/project");
    mocks.runtime.workspacePath = "/other";
    s.syncWorkspace();
    done({ entries: [] });
    await task;
    expect(s.directoryPath).toBe("/other");
  });
  it("discards older overlapping Git Diff results", async () => {
    const s = useWorkspaceFilesStore();
    s.syncWorkspace();
    let done!: (v: any) => void;
    mocks.diff.mockImplementationOnce(
      () =>
        new Promise((r) => {
          done = r;
        })
    );
    const old = s.refreshGitDiff();
    mocks.diff.mockResolvedValueOnce({ status: "ok", diffText: "latest", skipped: 0 });
    await s.refreshGitDiff();
    done({ status: "ok", diffText: "stale", skipped: 0 });
    await old;
    expect(s.gitDiff.diffText).toBe("latest");
  });
});
