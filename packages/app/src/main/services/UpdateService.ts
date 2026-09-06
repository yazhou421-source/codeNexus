import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { AppUpdateProgress, AppUpdateSnapshot, AppUpdateStatus } from "@codenexus/shared/ipc/contracts";

type UpdateInfoLike = {
  version?: unknown;
  releaseName?: unknown;
  releaseNotes?: unknown;
};

type ProgressInfoLike = {
  percent?: unknown;
  transferred?: unknown;
  total?: unknown;
  bytesPerSecond?: unknown;
};

function readErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/sha512|checksum/i.test(message)) return "Update verification failed. Download the update again.";
  if (/signature|code.?sign/i.test(message))
    return "Update signature verification failed. The update was not installed.";
  return "Update failed. Check the network or contact the release maintainer, then try again.";
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeReleaseNotes(value: unknown): string | null {
  if (typeof value === "string") return normalizeText(value);
  if (Array.isArray(value)) {
    const notes = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") return String((item as any).note ?? "").trim();
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
    return normalizeText(notes);
  }
  return null;
}

function normalizeProgress(value: ProgressInfoLike): AppUpdateProgress {
  const percent = Number(value.percent);
  const transferred = Number(value.transferred);
  const total = Number(value.total);
  const bytesPerSecond = Number(value.bytesPerSecond);
  return {
    percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0,
    transferred: Number.isFinite(transferred) ? Math.max(0, Math.round(transferred)) : 0,
    total: Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0,
    bytesPerSecond: Number.isFinite(bytesPerSecond) ? Math.max(0, Math.round(bytesPerSecond)) : 0,
  };
}

export class UpdateService {
  private state: AppUpdateSnapshot;
  private startupTimer: NodeJS.Timeout | null = null;
  private readonly feedConfigured: boolean;

  constructor(
    private readonly emitState: (snapshot: AppUpdateSnapshot) => void,
    private readonly options: { feedConfigured?: boolean; canInstall?: () => boolean } = {}
  ) {
    this.feedConfigured =
      options.feedConfigured ??
      (typeof process.resourcesPath === "string" && existsSync(join(process.resourcesPath, "app-update.yml")));
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    this.state = {
      status: app.isPackaged ? (this.feedConfigured ? "idle" : "unconfigured") : "unsupported",
      currentVersion: app.getVersion(),
      latestVersion: null,
      releaseName: null,
      releaseNotes: null,
      updateAvailable: false,
      downloaded: false,
      progress: null,
      errorMessage: app.isPackaged ? null : "Development mode does not connect to the production update feed.",
      checkedAt: null,
      isPackaged: app.isPackaged,
    };

    this.bindAutoUpdaterEvents();
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

  async checkForUpdates(): Promise<AppUpdateSnapshot> {
    if (!app.isPackaged) {
      this.patchState({
        status: "unsupported",
        errorMessage: "Development mode does not connect to the production update feed.",
        checkedAt: Date.now(),
      });
      return this.getState();
    }
    if (!this.feedConfigured) {
      this.patchState({ status: "unconfigured", checkedAt: Date.now(), errorMessage: null });
      return this.getState();
    }
    if (this.state.downloaded || this.state.status === "checking" || this.state.status === "downloading")
      return this.getState();

    this.patchState({
      status: "checking",
      progress: null,
      errorMessage: null,
      checkedAt: Date.now(),
    });

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.patchState({
        status: "error",
        errorMessage: readErrorMessage(error),
        checkedAt: Date.now(),
      });
    }
    return this.getState();
  }

  async downloadUpdate(): Promise<AppUpdateSnapshot> {
    if (!app.isPackaged || !this.feedConfigured) return this.checkForUpdates();
    if (this.state.status === "downloading" || this.state.status === "checking") return this.getState();
    if (this.state.status === "downloaded") return this.getState();
    if (!this.state.updateAvailable && this.state.status !== "available") {
      this.patchState({
        status: "error",
        errorMessage: "There is no update available to download.",
      });
      return this.getState();
    }

    this.patchState({ status: "downloading", errorMessage: null });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.patchState({
        status: "error",
        errorMessage: readErrorMessage(error),
      });
    }
    return this.getState();
  }

  quitAndInstall(): void {
    if (!app.isPackaged || !this.feedConfigured || !this.state.downloaded) return;
    if (this.options.canInstall && !this.options.canInstall()) {
      throw new Error("An AI task is running. Finish or stop it before restarting to install.");
    }
    autoUpdater.quitAndInstall(false, true);
  }

  private bindAutoUpdaterEvents(): void {
    autoUpdater.on("checking-for-update", () => {
      this.patchState({
        status: "checking",
        progress: null,
        errorMessage: null,
        checkedAt: Date.now(),
      });
    });
    autoUpdater.on("update-available", (info: UpdateInfoLike) => {
      this.patchState({
        status: "available",
        latestVersion: normalizeText(info?.version),
        releaseName: normalizeText(info?.releaseName),
        releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
        updateAvailable: true,
        downloaded: false,
        progress: null,
        errorMessage: null,
        checkedAt: Date.now(),
      });
    });
    autoUpdater.on("update-not-available", (info: UpdateInfoLike) => {
      this.patchState({
        status: "not_available",
        latestVersion: normalizeText(info?.version) ?? this.state.currentVersion,
        releaseName: normalizeText(info?.releaseName),
        releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
        updateAvailable: false,
        downloaded: false,
        progress: null,
        errorMessage: null,
        checkedAt: Date.now(),
      });
    });
    autoUpdater.on("download-progress", (progress: ProgressInfoLike) => {
      this.patchState({
        status: "downloading",
        updateAvailable: true,
        downloaded: false,
        progress: normalizeProgress(progress),
        errorMessage: null,
      });
    });
    autoUpdater.on("update-downloaded", (info: UpdateInfoLike) => {
      this.patchState({
        status: "downloaded",
        latestVersion: normalizeText(info?.version) ?? this.state.latestVersion,
        releaseName: normalizeText(info?.releaseName) ?? this.state.releaseName,
        releaseNotes: normalizeReleaseNotes(info?.releaseNotes) ?? this.state.releaseNotes,
        updateAvailable: true,
        downloaded: true,
        progress: { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 },
        errorMessage: null,
      });
    });
    autoUpdater.on("error", (error: unknown) => {
      this.patchState({
        status: this.state.downloaded ? "downloaded" : "error",
        errorMessage: readErrorMessage(error),
      });
    });
  }

  private patchState(patch: Partial<AppUpdateSnapshot> & { status?: AppUpdateStatus }): void {
    this.state = { ...this.state, ...patch };
    this.emitState(this.getState());
  }
}
