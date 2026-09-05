import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceAccessService } from "./WorkspaceAccessService";

let root: string, a: string, b: string;
let sender: any, event: any, service: WorkspaceAccessService;
const confirm = vi.fn();
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "workspace-access-")));
  a = join(root, "a");
  b = join(root, "b");
  await mkdir(a);
  await mkdir(b);
  sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  event = { sender, senderFrame: sender.mainFrame };
  confirm.mockReset().mockResolvedValue(false);
  service = new WorkspaceAccessService(() => sender, confirm);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("main-owned workspace authorization", () => {
  it("rejects arbitrary roots before native confirmation", async () => {
    await expect(service.workspace(event, a)).rejects.toThrow("Workspace access denied");
    expect(await service.activate(event, a)).toBe(false);
    await expect(service.workspace(event, a)).rejects.toThrow("Workspace access denied");
  });
  it("accepts a native picker grant without a second prompt", async () => {
    await service.grantSelection(event, a);
    expect(await service.activate(event, a)).toBe(true);
    expect((await service.workspace(event, a)).root).toBe(a);
    expect(confirm).not.toHaveBeenCalled();
  });
  it("requires confirmation when restoring a previously unknown history path", async () => {
    confirm.mockResolvedValue(true);
    expect(await service.activate(event, a)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(a);
    await service.workspace(event, a);
  });
  it("rejects foreign senders and subframes", async () => {
    await expect(service.activate({ ...event, sender: {} }, a)).rejects.toThrow();
    await expect(service.activate({ ...event, senderFrame: {} }, a)).rejects.toThrow();
    expect(confirm).not.toHaveBeenCalled();
  });
  it("rejects another authorized but inactive workspace and stale leases", async () => {
    await service.grantSelection(event, a);
    await service.activate(event, a);
    const lease = await service.workspace(event, a);
    await service.grantSelection(event, b);
    await service.activate(event, b);
    expect(() => lease.assertCurrent()).toThrow();
    await expect(service.workspace(event, a)).rejects.toThrow();
  });
  it("rejects sibling-prefix paths and symlink escapes", async () => {
    await service.grantSelection(event, a);
    await service.activate(event, a);
    await symlink(b, join(a, "link"), "dir");
    await expect(service.path(event, b)).rejects.toThrow();
    await expect(service.path(event, join(a, "link"))).rejects.toThrow();
  });
  it.each(["destroyed", "render-process-gone"])("revokes grants on %s", async (name) => {
    await service.grantSelection(event, a);
    await service.activate(event, a);
    const lease = await service.workspace(event, a);
    sender.emit(name);
    expect(() => lease.assertCurrent()).toThrow();
    await expect(service.workspace(event, a)).rejects.toThrow();
  });
  it("keeps the current workspace and lease when a new native confirmation is cancelled", async () => {
    await service.grantSelection(event, a);
    await service.activate(event, a);
    const lease = await service.workspace(event, a);
    expect(await service.activate(event, b)).toBe(false);
    expect(() => lease.assertCurrent()).not.toThrow();
    await service.workspace(event, a);
  });
  it("revokes grants on main-frame navigation but not subframe navigation", async () => {
    await service.grantSelection(event, a);
    await service.activate(event, a);
    sender.emit("did-start-navigation", {}, "", false, false);
    await service.workspace(event, a);
    sender.emit("did-start-navigation", {}, "", false, true);
    await expect(service.workspace(event, a)).rejects.toThrow();
  });
  it("does not let an old confirmation replace a newer activation", async () => {
    let done!: (value: boolean) => void;
    confirm.mockImplementationOnce(
      () =>
        new Promise((r) => {
          done = r;
        })
    );
    const old = service.activate(event, a);
    await vi.waitFor(() => expect(done).toBeDefined());
    await service.grantSelection(event, b);
    await service.activate(event, b);
    done(true);
    expect(await old).toBe(false);
    await service.workspace(event, b);
  });
});
