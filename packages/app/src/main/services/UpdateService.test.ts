import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => "1.0.5" },
  updater: null as any,
  native: null as any,
  openPath: vi.fn(async () => ""),
}));
vi.mock("electron", () => ({
  app: mocks.app,
  shell: { openPath: mocks.openPath },
  get autoUpdater() {
    return mocks.native;
  },
}));
vi.mock("electron-updater", () => ({
  get autoUpdater() {
    return mocks.updater;
  },
}));
import { PRODUCTION_UPDATE_FEED, UpdateService } from "./UpdateService";
const services: UpdateService[] = [];
const create = (options: ConstructorParameters<typeof UpdateService>[1] = {}) => {
  const service = new UpdateService(vi.fn(), { feedConfigured: true, automaticInstall: true, ...options });
  services.push(service);
  return service;
};
const available = (extra = {}) =>
  mocks.updater.emit("update-available", { version: "1.0.6", releaseNotes: "Changes", ...extra });
const downloaded = (extra = {}) => mocks.updater.emit("update-downloaded", { version: "1.0.6", ...extra });
beforeEach(() => {
  mocks.app.isPackaged = true;
  mocks.updater = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => {}),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
  });
  mocks.native = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn() });
  mocks.openPath.mockClear();
});
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  vi.useRealTimers();
});

describe("desktop update lifecycle", () => {
  it("A: packaged configured build is idle and pins the GitHub stable source", () => {
    expect(create().getState().status).toBe("idle");
    expect(mocks.updater.setFeedURL).toHaveBeenCalledWith(PRODUCTION_UPDATE_FEED);
    expect(mocks.updater).toMatchObject({
      allowDowngrade: false,
      allowPrerelease: false,
      autoDownload: false,
      autoInstallOnAppQuit: false,
    });
  });
  it("B: no feed stays unconfigured without any network operation", async () => {
    const service = create({ feedConfigured: false });
    service.scheduleStartupCheck(0);
    expect((await service.checkForUpdates()).status).toBe("unconfigured");
    expect((await service.downloadUpdate()).status).toBe("unconfigured");
    await service.quitAndInstall();
    expect(mocks.updater.setFeedURL).not.toHaveBeenCalled();
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled();
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it("keeps development builds off the update feed", async () => {
    mocks.app.isPackaged = false;
    expect((await create().checkForUpdates()).status).toBe("unsupported");
    expect(mocks.updater.setFeedURL).not.toHaveBeenCalled();
  });
  it("C: check with no update is quiet and clears availability", async () => {
    const service = create();
    available();
    mocks.updater.checkForUpdates.mockImplementation(async () =>
      mocks.updater.emit("update-not-available", { version: "1.0.5" })
    );
    expect(await service.checkForUpdates()).toMatchObject({
      status: "not_available",
      updateAvailable: false,
      progress: null,
    });
  });
  it("D/E/I: checks, downloads real progress, stages and installs on explicit request", async () => {
    const service = create();
    mocks.updater.checkForUpdates.mockImplementation(async () => available());
    expect(await service.checkForUpdates()).toMatchObject({ status: "available", latestVersion: "1.0.6" });
    await service.quitAndInstall();
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
    mocks.updater.downloadUpdate.mockImplementation(async () => {
      mocks.updater.emit("download-progress", { percent: 50, transferred: 100, total: 200 });
      expect(service.getState()).toMatchObject({
        status: "downloading",
        progress: { percent: 50, transferred: 100, total: 200 },
      });
      downloaded();
    });
    expect((await service.downloadUpdate()).status).toBe("downloaded");
    expect((await service.checkForUpdates()).status).toBe("downloaded");
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await service.quitAndInstall();
    if (process.platform === "darwin") mocks.native.emit("update-downloaded");
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);
  });
  it.each([
    "sha512 checksum mismatch",
    "ENOTFOUND offline",
    "GitHub timeout",
    "404",
    "403 rate limit",
    "YAML metadata parse",
    "ZIP file not provided",
    "ECONNRESET interrupted",
  ])("F/G/O: %s clears progress, hides raw secrets and permits retry", async (message) => {
    const service = create();
    available();
    mocks.updater.downloadUpdate.mockImplementationOnce(async () => {
      mocks.updater.emit("download-progress", { percent: 80, transferred: 80, total: 100 });
      throw new Error(`${message} token=secret /Users/private`);
    });
    const state = await service.downloadUpdate();
    expect(state).toMatchObject({ status: "error", downloaded: false, progress: null, updateAvailable: true });
    expect(JSON.stringify(state)).not.toMatch(/secret|\/Users/);
    mocks.updater.downloadUpdate.mockImplementationOnce(async () => downloaded());
    expect((await service.downloadUpdate()).status).toBe("downloaded");
    expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(2);
  });
  it("G: permits a new check after network failure", async () => {
    const service = create();
    mocks.updater.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
    expect((await service.checkForUpdates()).status).toBe("error");
    mocks.updater.checkForUpdates.mockImplementationOnce(async () => available());
    expect((await service.checkForUpdates()).status).toBe("available");
  });
  it.each(["agent turn", "file write", "approval waiting", "turn start in flight"])(
    "H: does not quit while %s is busy",
    async () => {
      const service = create({ canInstall: () => false });
      downloaded();
      await expect(service.quitAndInstall()).rejects.toThrow(/AI task is running/);
      expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
      expect(mocks.native.checkForUpdates).not.toHaveBeenCalled();
      expect(service.getState().downloaded).toBe(true);
    }
  );
  it("rechecks task safety after asynchronous native staging", async () => {
    if (process.platform !== "darwin") return;
    let busy = false;
    const service = create({ canInstall: () => !busy });
    downloaded();
    await service.quitAndInstall();
    busy = true;
    mocks.native.emit("update-downloaded");
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
    expect(service.getState().status).toBe("downloaded");
    busy = false;
    await service.quitAndInstall();
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
  it.each(["1.0.4", "1.0.5", "1.0.6-beta.1", "bogus", undefined])(
    "J/K: refuses non-newer stable version %s",
    async (version) => {
      const service = create();
      available({ version });
      expect(service.getState()).toMatchObject({ status: "error", updateAvailable: false });
      await service.downloadUpdate();
      expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled();
    }
  );
  it("L: parses release notes/date and ignores malformed values", () => {
    const service = create();
    available({ releaseNotes: [{ note: "First" }, { note: "Second" }], releaseDate: "2026-09-07T00:00:00Z" });
    expect(service.getState()).toMatchObject({
      releaseNotes: "First\n\nSecond",
      releaseDate: "2026-09-07T00:00:00.000Z",
    });
    available({ releaseDate: new Date("2026-09-07T00:00:00Z") });
    expect(service.getState().releaseDate).toBe("2026-09-07T00:00:00.000Z");
    available({ releaseNotes: {}, releaseDate: "bad" });
    expect(service.getState()).toMatchObject({ releaseNotes: null, releaseDate: null });
  });
  it("M: schedules one check after 3 seconds and disposes pending timers", async () => {
    vi.useFakeTimers();
    const service = create();
    service.scheduleStartupCheck();
    service.scheduleStartupCheck();
    await vi.advanceTimersByTimeAsync(2999);
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    service.scheduleStartupCheck();
    service.dispose();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
  it("N: serializes operations even if an error event arrives before rejection", async () => {
    const service = create();
    let finish!: () => void;
    mocks.updater.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const checking = service.checkForUpdates();
    mocks.updater.emit("error", new Error("timeout"));
    await service.checkForUpdates();
    await service.downloadUpdate();
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    finish();
    await checking;
    available();
    mocks.updater.downloadUpdate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const downloading = service.downloadUpdate();
    await service.downloadUpdate();
    await service.checkForUpdates();
    expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    finish();
    await downloading;
  });
  it("manual mode never quits; opens only an updater-returned existing installer", async () => {
    const service = create({ automaticInstall: false });
    downloaded({ downloadedFile: __filename });
    await service.quitAndInstall();
    expect(mocks.openPath).toHaveBeenCalledWith(__filename);
    expect(mocks.native.checkForUpdates).not.toHaveBeenCalled();
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it("a missing cached installer returns to a retryable error", async () => {
    const service = create({ automaticInstall: false });
    downloaded();
    await service.quitAndInstall();
    expect(service.getState()).toMatchObject({ status: "error", downloaded: false, updateAvailable: true });
    expect(mocks.openPath).not.toHaveBeenCalled();
  });
});
