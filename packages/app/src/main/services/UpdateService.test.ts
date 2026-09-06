import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ app: { isPackaged: true, getVersion: () => "1.0.4" }, updater: null as any }));
vi.mock("electron", () => ({ app: mocks.app }));
vi.mock("electron-updater", () => ({
  get autoUpdater() {
    return mocks.updater;
  },
}));
import { UpdateService } from "./UpdateService";

beforeEach(() => {
  mocks.app.isPackaged = true;
  mocks.updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => {}),
    downloadUpdate: vi.fn(async () => {}),
    quitAndInstall: vi.fn(),
  });
});
const create = (feedConfigured = true, canInstall = () => true) =>
  new UpdateService(vi.fn(), { feedConfigured, canInstall });
const available = () => mocks.updater.emit("update-available", { version: "1.0.5", releaseNotes: "Changes" });

describe("desktop update lifecycle", () => {
  it("does not connect to any feed when unconfigured", async () => {
    const service = create(false);
    service.scheduleStartupCheck(0);
    expect((await service.checkForUpdates()).status).toBe("unconfigured");
    expect((await service.downloadUpdate()).status).toBe("unconfigured");
    service.quitAndInstall();
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled();
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it("keeps development builds off the update feed", async () => {
    mocks.app.isPackaged = false;
    expect((await create().checkForUpdates()).status).toBe("unsupported");
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled();
  });
  it("checks, downloads with progress, and installs only after completion", async () => {
    const service = create();
    mocks.updater.checkForUpdates.mockImplementation(async () => available());
    const state = await service.checkForUpdates();
    expect(state).toMatchObject({ status: "available", currentVersion: "1.0.4", latestVersion: "1.0.5" });
    service.quitAndInstall();
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
    mocks.updater.downloadUpdate.mockImplementation(async () => {
      mocks.updater.emit("download-progress", { percent: 50, transferred: 100, total: 200 });
      expect(service.getState()).toMatchObject({
        status: "downloading",
        progress: { percent: 50, transferred: 100, total: 200 },
      });
      mocks.updater.emit("update-downloaded", { version: "1.0.5" });
    });
    expect((await service.downloadUpdate()).downloaded).toBe(true);
    service.quitAndInstall();
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(mocks.updater.autoDownload).toBe(false);
    expect(mocks.updater.autoInstallOnAppQuit).toBe(false);
    expect(mocks.updater.allowDowngrade).toBe(false);
  });
  it("does not discard a ready update when checking again", async () => {
    const service = create();
    mocks.updater.emit("update-downloaded", { version: "1.0.5" });
    expect((await service.checkForUpdates()).status).toBe("downloaded");
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled();
  });
  it("deduplicates checks and downloads", async () => {
    const service = create();
    await Promise.all([service.checkForUpdates(), service.checkForUpdates()]);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    available();
    await Promise.all([service.downloadUpdate(), service.downloadUpdate()]);
    expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });
  it("supports retry after download failure and keeps errors free of raw tokens", async () => {
    const service = create();
    available();
    mocks.updater.downloadUpdate.mockRejectedValueOnce(new Error("https://private.invalid?token=secret"));
    const state = await service.downloadUpdate();
    expect(state).toMatchObject({ status: "error", updateAvailable: true });
    expect(JSON.stringify(state)).not.toContain("secret");
    await service.downloadUpdate();
    expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(2);
  });
  it("does not restart while a task is running", () => {
    const service = create(true, () => false);
    mocks.updater.emit("update-downloaded", { version: "1.0.5" });
    expect(() => service.quitAndInstall()).toThrow(/task is running/);
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
    expect(service.getState().downloaded).toBe(true);
  });
  it("shows no-update and offline states distinctly", async () => {
    const service = create();
    mocks.updater.checkForUpdates.mockImplementationOnce(async () =>
      mocks.updater.emit("update-not-available", { version: "1.0.4" })
    );
    expect((await service.checkForUpdates()).status).toBe("not_available");
    mocks.updater.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
    expect((await service.checkForUpdates()).status).toBe("error");
  });
});
