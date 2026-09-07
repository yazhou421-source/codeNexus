import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { WorkspaceAccessService } from "../../services/WorkspaceAccessService";
import { registerWorkspaceHandlers } from "./workspace.handlers";
import { registerAppHandlers } from "./app.handlers";
import { WorkspacePatchService } from "../../services/WorkspacePatchService";
import { IPC_APP_CHANNELS, IPC_WORKSPACE_CHANNELS } from "@codenexus/shared/ipc/channels";

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock("electron", () => ({ ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler) } }));
let root: string;
let access: WorkspaceAccessService, event: any;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "calmnova-status-")));
  execFileSync("git", ["init", "-q", root]);
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  event = { sender, senderFrame: sender.mainFrame };
  access = new WorkspaceAccessService(
    () => sender as any,
    async () => false
  );
  await access.grantSelection(event, root);
  await access.activate(event, root);
  registerWorkspaceHandlers({ workspacePatchService: new WorkspacePatchService(), workspaceAccess: access } as any);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("does not expose sibling workspace file names through the status DTO", async () => {
  await mkdir(join(root, "selected"));
  await access.grantSelection(event, join(root, "selected"));
  await access.activate(event, join(root, "selected"));
  await writeFile(join(root, "outside.txt"), "outside fixture");
  await writeFile(join(root, "selected", "inside.txt"), "inside fixture");
  const result = await handlers.get(IPC_WORKSPACE_CHANNELS.workspaceGitStatusRead)!(event, {
    cwd: join(root, "selected"),
  });
  expect(result.ok).toBe(true);
  expect(result.entries.map((e: any) => e.path)).toEqual([join(root, "selected", "inside.txt")]);
});
it("excludes noisy directories from automatic Git status queries", async () => {
  for (const name of ["node_modules", "dist", "release", ".cache"]) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, "noise.txt"), "noise");
  }
  const result = await handlers.get(IPC_WORKSPACE_CHANNELS.workspaceGitStatusRead)!(event, { cwd: root });
  expect(result.ok).toBe(true);
  expect(result.entries).toEqual([]);
});
it("rejects an expanded directory replaced by a symlink outside the workspace", async () => {
  registerAppHandlers({ workspaceAccess: access } as any);
  await mkdir(join(root, "selected"));
  await access.grantSelection(event, join(root, "selected"));
  await access.activate(event, join(root, "selected"));
  await mkdir(join(root, "outside"));
  await writeFile(join(root, "outside", "private-name.txt"), "fixture");
  await symlink(join(root, "outside"), join(root, "selected", "replaced"), "dir");
  await expect(
    handlers.get(IPC_APP_CHANNELS.appReadDirectory)!(event, {
      path: join(root, "selected", "replaced"),
      workspaceRoot: join(root, "selected"),
    })
  ).rejects.toThrow();
});
it("rejects a renderer-chosen Git root even if it is a valid repository", async () => {
  const selected = join(root, "selected");
  await mkdir(selected);
  await access.grantSelection(event, selected);
  await access.activate(event, selected);
  await writeFile(join(root, "outside.txt"), "outside fixture");
  await expect(handlers.get(IPC_WORKSPACE_CHANNELS.workspaceGitDiffRead)!(event, { cwd: root })).rejects.toThrow();
});
it.each([undefined, "forged"])("does not trust an omitted/forged workspaceRoot (%s)", async (hint) => {
  registerAppHandlers({ workspaceAccess: access } as any);
  const selected = join(root, "selected");
  await mkdir(selected);
  await access.grantSelection(event, selected);
  await access.activate(event, selected);
  await expect(
    handlers.get(IPC_APP_CHANNELS.appReadDirectory)!(event, {
      path: root,
      ...(hint ? { workspaceRoot: root } : {}),
    })
  ).rejects.toThrow();
});
it("rejects foreign-window Diff reads", async () => {
  await expect(
    handlers.get(IPC_WORKSPACE_CHANNELS.workspaceGitDiffRead)!({ ...event, sender: {} }, { cwd: root })
  ).rejects.toThrow();
});
it("blocks text reads outside the active workspace, including secret-named app state", async () => {
  registerAppHandlers({ workspaceAccess: access, localSettingsService: { path: join(root, "settings.json") } } as any);
  const selected = join(root, "selected");
  await mkdir(selected);
  await access.grantSelection(event, selected);
  await access.activate(event, selected);
  await writeFile(join(root, "provider-secrets.json"), "non-secret fixture");
  await expect(
    handlers.get(IPC_APP_CHANNELS.appReadTextFile)!(event, { path: join(root, "provider-secrets.json") })
  ).rejects.toThrow();
});
it("preserves only exact draft/outbox reads and rejects a symlinked state file", async () => {
  registerAppHandlers({ workspaceAccess: access, localSettingsService: { path: join(root, "settings.json") } } as any);
  const selected = join(root, "selected");
  await mkdir(selected);
  await access.grantSelection(event, selected);
  await access.activate(event, selected);
  expect(
    await handlers.get(IPC_APP_CHANNELS.appReadTextFile)!(event, { path: join(root, "draft-state.json") })
  ).toMatchObject({ content: "" });
  await writeFile(join(root, "message-outbox.json"), "{}");
  expect(
    await handlers.get(IPC_APP_CHANNELS.appReadTextFile)!(event, { path: join(root, "message-outbox.json") })
  ).toMatchObject({ content: "{}" });
  await symlink(join(root, "message-outbox.json"), join(root, "draft-state.json"));
  await expect(
    handlers.get(IPC_APP_CHANNELS.appReadTextFile)!(event, { path: join(root, "draft-state.json") })
  ).rejects.toThrow();
});
it("discards a Diff result that completes after workspace authorization changes", async () => {
  let done!: (v: any) => void;
  const read = vi.fn(
    () =>
      new Promise((r) => {
        done = r;
      })
  );
  registerWorkspaceHandlers({ workspaceAccess: access, workspacePatchService: { readGitDiff: read } as any });
  const task = handlers.get(IPC_WORKSPACE_CHANNELS.workspaceGitDiffRead)!(event, { cwd: root });
  await vi.waitFor(() => expect(done).toBeDefined());
  await access.activate(event, "");
  done({ status: "ok", diffText: "stale fixture", skipped: 0 });
  await expect(task).rejects.toThrow();
});
