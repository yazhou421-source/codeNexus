import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { app, shell, autoUpdater as nativeUpdater } from "electron";
import { autoUpdater } from "electron-updater";
import type { AppUpdateProgress, AppUpdateSnapshot } from "@codenexus/shared/ipc/contracts";

export const PRODUCTION_UPDATE_FEED = Object.freeze({
  provider: "github" as const,
  owner: "yazhou421-source",
  repo: "codeNexus",
  private: false,
  releaseType: "release" as const,
});

type UpdateInfoLike = {
  version?: unknown;
  releaseName?: unknown;
  releaseNotes?: unknown;
  releaseDate?: unknown;
  downloadedFile?: string;
};
type ProgressInfoLike = Partial<AppUpdateProgress>;

export function supportsAutomaticInstall(): boolean {
  if (process.platform !== "darwin") return true;
  const bundle = resolve(dirname(process.execPath), "../..");
  const result = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", bundle], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 && /^Authority=Developer ID Application:/m.test(result.stderr);
}

function readErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/sha512|checksum/i.test(message)) return "Update verification failed. Download the update again.";
  if (/signature|code.?sign/i.test(message))
    return "Update signature verification failed. The update was not installed.";
  if (/429|403|rate.?limit/i.test(message)) return "GitHub request limit reached. Try again later.";
  if (/404|not.found|ZIP file not provided/i.test(message))
    return "Release metadata or an update asset is missing. Try checking again later.";
  if (/yaml|metadata|parse|version/i.test(message)) return "Release metadata is invalid. Try checking again later.";
  if (/timeout|timed.out/i.test(message)) return "GitHub timed out. Check your connection and retry.";
  return "Update failed. Check the network or contact the release maintainer, then try again.";
}
function normalizeText(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}
function normalizeReleaseNotes(value: unknown): string | null {
  if (typeof value === "string") return normalizeText(value);
  if (!Array.isArray(value)) return null;
  return normalizeText(
    value
      .map((item) => (typeof item === "string" ? item : normalizeText(item?.note)))
      .filter(Boolean)
      .join("\n\n")
  );
}
function metadata(info: UpdateInfoLike) {
  const date =
    info.releaseDate instanceof Date && Number.isFinite(info.releaseDate.getTime())
      ? info.releaseDate.toISOString()
      : normalizeText(info.releaseDate);
  return {
    latestVersion: normalizeText(info.version),
    releaseName: normalizeText(info.releaseName),
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    releaseDate: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null,
  };
}
function isNewerStable(version: unknown, current: string): boolean {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\w.-]+)?$/;
  const next = typeof version === "string" ? stable.exec(version) : null;
  const previous = stable.exec(current);
  if (!next || !previous) return false;
  for (let i = 1; i <= 3; i++) {
    if (BigInt(next[i]) !== BigInt(previous[i])) return BigInt(next[i]) > BigInt(previous[i]);
  }
  return false;
}
function normalizeProgress(value: ProgressInfoLike): AppUpdateProgress {
  const positive = (n: unknown) => (Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0);
  return {
    percent: Math.min(100, positive(value.percent)),
    transferred: Math.round(positive(value.transferred)),
    total: Math.round(positive(value.total)),
    bytesPerSecond: Math.round(positive(value.bytesPerSecond)),
  };
}

export class UpdateService {
  private state: AppUpdateSnapshot;
  private startupTimer: NodeJS.Timeout | null = null;
  private installTimer: NodeJS.Timeout | null = null;
  private readonly feedConfigured: boolean;
  private readonly updater: typeof autoUpdater;
  private operation: "check" | "download" | null = null;
  private downloadedFile: string | null = null;
  private readonly listeners: Array<[Parameters<typeof autoUpdater.on>[0], (...args: any[]) => void]> = [];
  private nativeReady = false;
  private readonly onNativeReady = () => {
    this.nativeReady = true;
    if (this.state.status !== "installing") return;
    this.clearInstallTimer();
    // Squirrel stages asynchronously. Recheck tasks immediately before quitting.
    if (this.options.canInstall && !this.options.canInstall()) {
      this.patchState({
        status: "downloaded",
        errorMessage: "AI task is running. Finish or stop it before installing.",
      });
      return;
    }
    this.updater.quitAndInstall(false, true);
  };

  constructor(
    private readonly emitState: (snapshot: AppUpdateSnapshot) => void,
    // Injection is for compiled test harnesses only. No env, IPC or user feed override exists.
    private readonly options: {
      feedConfigured?: boolean;
      canInstall?: () => boolean;
      updater?: typeof autoUpdater;
      automaticInstall?: boolean;
    } = {}
  ) {
    this.updater = options.updater ?? autoUpdater;
    this.feedConfigured =
      options.feedConfigured ??
      (typeof process.resourcesPath === "string" && existsSync(join(process.resourcesPath, "app-update.yml")));
    if (app.isPackaged && this.feedConfigured && !options.updater) this.updater.setFeedURL(PRODUCTION_UPDATE_FEED);
    this.updater.allowDowngrade = false;
    this.updater.allowPrerelease = false;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.state = {
      status: app.isPackaged ? (this.feedConfigured ? "idle" : "unconfigured") : "unsupported",
      currentVersion: app.getVersion(),
      latestVersion: null,
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      installMode:
        (options.automaticInstall ?? (app.isPackaged && supportsAutomaticInstall())) ? "automatic" : "manual",
      updateAvailable: false,
      downloaded: false,
      progress: null,
      errorMessage: app.isPackaged ? null : "Development mode does not connect to the production update feed.",
      checkedAt: null,
      isPackaged: app.isPackaged,
    };
    this.bindAutoUpdaterEvents();
    if (process.platform === "darwin") nativeUpdater.on("update-downloaded", this.onNativeReady);
  }

  getState(): AppUpdateSnapshot {
    return { ...this.state, progress: this.state.progress ? { ...this.state.progress } : null };
  }
  scheduleStartupCheck(delayMs = 3_000): void {
    if (!app.isPackaged || !this.feedConfigured || this.startupTimer) return;
    this.startupTimer = setTimeout(
      () => {
        this.startupTimer = null;
        void this.checkForUpdates();
      },
      Math.max(0, Math.round(delayMs))
    );
    this.startupTimer.unref?.();
  }
  dispose(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
    this.clearInstallTimer();
    for (const [event, listener] of this.listeners) this.updater.removeListener(event, listener);
    nativeUpdater.removeListener("update-downloaded", this.onNativeReady);
  }
  private clearInstallTimer(): void {
    if (this.installTimer) clearTimeout(this.installTimer);
    this.installTimer = null;
  }
  async checkForUpdates(): Promise<AppUpdateSnapshot> {
    if (!app.isPackaged || !this.feedConfigured) return this.getState();
    if (this.operation || this.state.downloaded || this.state.status === "installing") return this.getState();
    this.operation = "check";
    this.patchState({
      status: "checking",
      updateAvailable: false,
      downloaded: false,
      progress: null,
      errorMessage: null,
      checkedAt: Date.now(),
    });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.fail(error);
    } finally {
      this.operation = null;
    }
    return this.getState();
  }
  async downloadUpdate(): Promise<AppUpdateSnapshot> {
    if (!app.isPackaged || !this.feedConfigured || this.operation || this.state.downloaded) return this.getState();
    if (!this.state.updateAvailable) return this.getState();
    this.operation = "download";
    this.downloadedFile = null;
    this.patchState({ status: "downloading", progress: null, errorMessage: null });
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.fail(error);
    } finally {
      this.operation = null;
    }
    return this.getState();
  }
  async quitAndInstall(): Promise<void> {
    if (!app.isPackaged || !this.feedConfigured || !this.state.downloaded || this.state.status === "installing") return;
    if (this.options.canInstall && !this.options.canInstall())
      throw new Error("AI task is running. Finish or stop it before installing.");
    if (this.state.installMode === "manual") {
      if (!this.downloadedFile || !existsSync(this.downloadedFile)) {
        this.downloadedFile = null;
        this.patchState({
          status: "error",
          downloaded: false,
          errorMessage: "Downloaded installer is missing. Download the update again.",
        });
        return;
      }
      // Open only the ZIP validated and returned by electron-updater. macOS handles it;
      // this app never extracts, replaces or deletes an application bundle.
      const error = await shell.openPath(this.downloadedFile);
      if (error) throw new Error("Unable to open the downloaded installer.");
      return;
    }
    this.patchState({ status: "installing", errorMessage: null });
    try {
      if (process.platform === "darwin" && !this.nativeReady) {
        this.installTimer = setTimeout(() => {
          this.patchState({
            status: "downloaded",
            errorMessage: "Installation preparation timed out. Retry when ready.",
          });
        }, 60_000);
        nativeUpdater.checkForUpdates();
      } else this.updater.quitAndInstall(false, true);
    } catch (error) {
      this.fail(error);
    }
  }
  private fail(error: unknown): void {
    this.clearInstallTimer();
    const installing = this.state.status === "installing";
    this.patchState({
      status: installing ? "downloaded" : "error",
      downloaded: installing,
      progress: null,
      errorMessage: readErrorMessage(error),
    });
  }
  private bindAutoUpdaterEvents(): void {
    const on = (event: Parameters<typeof autoUpdater.on>[0], listener: (...args: any[]) => void) => {
      this.listeners.push([event, listener]);
      this.updater.on(event, listener);
    };
    on("checking-for-update", () =>
      this.patchState({ status: "checking", progress: null, errorMessage: null, checkedAt: Date.now() })
    );
    on("update-available", (info: UpdateInfoLike) => {
      if (!isNewerStable(info.version, this.state.currentVersion)) {
        this.patchState({
          status: "error",
          updateAvailable: false,
          downloaded: false,
          progress: null,
          errorMessage: "Release version is invalid, not newer, or not stable.",
        });
        return;
      }
      this.patchState({
        ...metadata(info),
        status: "available",
        updateAvailable: true,
        downloaded: false,
        progress: null,
        errorMessage: null,
        checkedAt: Date.now(),
      });
    });
    on("update-not-available", (info: UpdateInfoLike) =>
      this.patchState({
        ...metadata(info),
        status: "not_available",
        updateAvailable: false,
        downloaded: false,
        progress: null,
        errorMessage: null,
        checkedAt: Date.now(),
      })
    );
    on("download-progress", (progress: ProgressInfoLike) => {
      if (this.state.status !== "downloading") return;
      this.patchState({ progress: normalizeProgress(progress) });
    });
    on("update-downloaded", (info: UpdateInfoLike) => {
      if (!isNewerStable(info.version, this.state.currentVersion)) {
        this.fail(new Error("Invalid release version"));
        return;
      }
      this.downloadedFile = info.downloadedFile ?? null;
      this.patchState({
        ...metadata(info),
        status: "downloaded",
        updateAvailable: true,
        downloaded: true,
        progress: null,
        errorMessage: null,
      });
    });
    on("error", (error: unknown) => this.fail(error));
  }
  private patchState(patch: Partial<AppUpdateSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.emitState(this.getState());
  }
}
