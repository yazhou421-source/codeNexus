import { defineStore } from "./zustandCompat";
import {
  getImagegenDesktopApi,
  getImagegenWorkspacePath,
  getInitialImagegenSettings,
  readImagegenSettings,
  showImagegenToast as showToast,
  translateImagegen as translate,
} from "./runtimeBridge";
import type {
  ImageGenerationGenerateArgs,
  ImageGenerationHistoryItem,
  ImageGenerationTaskItem,
} from "../types";

export type ImageWorkbenchMode = "generate" | "edit";
export type ImageWorkbenchHistoryStatus =
  | "ready"
  | "pending"
  | "failed"
  | "canceled";
export type ImageWorkbenchHistoryItem = ImageGenerationHistoryItem & {
  workbenchStatus?: ImageWorkbenchHistoryStatus;
  requestId?: string;
  taskId?: string;
  pendingImageCount?: number;
  errorText?: string;
};

type InputImage = {
  id: string;
  name: string;
  dataUrl: string;
};

function sanitizeCompression(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(new Error(translate("imageWorkbench.readImageFailed")));
    reader.readAsDataURL(file);
  });
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function logImageWorkbench(message: string, data?: Record<string, unknown>) {
  console.info(`[ImageWorkbench] ${message}`, data ?? {});
}

function taskToHistoryItem(
  task: ImageGenerationTaskItem,
  model: string,
): ImageWorkbenchHistoryItem {
  const args = task.args;
  const inputImages = Array.isArray(args.inputImages) ? args.inputImages : [];
  const mode: ImageWorkbenchMode = inputImages.length > 0 ? "edit" : "generate";
  const pending = task.status === "queued" || task.status === "running";
  const failed = task.status === "failed";
  const canceled = task.status === "canceled";
  return {
    id: `task:${task.id}`,
    requestId: `task:${task.id}`,
    taskId: task.id,
    workbenchStatus: pending
      ? "pending"
      : canceled
        ? "canceled"
        : failed
          ? "failed"
          : "failed",
    pendingImageCount: Number(args.n) || 1,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    workspacePath: args.workspacePath ?? null,
    model,
    prompt: args.prompt,
    revisedPrompt: null,
    mode,
    size: args.size ?? null,
    quality: args.quality ?? null,
    outputFormat: args.outputFormat ?? null,
    background: args.background ?? null,
    moderation: args.moderation ?? null,
    outputCompression:
      typeof args.outputCompression === "number"
        ? args.outputCompression
        : null,
    images: [],
    errorText: pending
      ? task.status === "queued"
        ? translate("imageWorkbench.queued")
        : translate("imageWorkbench.generating")
      : canceled
        ? task.errorText || translate("imageWorkbench.canceled")
        : task.errorText || translate("imageWorkbench.imageGenerationFailed"),
  };
}

function initialSettings() {
  return getInitialImagegenSettings();
}

const settings = initialSettings();

export const useImageWorkbenchStore = defineStore("imageWorkbench", {
  state: () => ({
    imageSettings: settings,
    prompt: "",
    quality: settings.defaultQuality || "auto",
    outputCompression: settings.outputCompression ?? 100,
    inputImages: [] as InputImage[],
    maskDataUrl: null as string | null,
    activeGenerationCount: 0,
    errorText: "",
    historyItems: [] as ImageWorkbenchHistoryItem[],
    generationTasks: [] as ImageGenerationTaskItem[],
    selectedHistoryId: "" as string,
    historyLoading: false,
    historyLoadSeq: 0,
    historyErrorText: "",
    taskPollingTimer: null as number | null,
    dragActive: false,
    missingConfigurationNoticeShown: false,
  }),
  getters: {
    configured(state) {
      return Boolean(
        state.imageSettings.enabled &&
        state.imageSettings.baseUrl &&
        state.imageSettings.apiKey,
      );
    },
    busy(state): boolean {
      return (
        state.activeGenerationCount > 0 ||
        state.generationTasks.some(
          (task) => task.status === "queued" || task.status === "running",
        )
      );
    },
    canGenerate(state): boolean {
      return Boolean(state.prompt.trim());
    },
    selectedHistoryItem(state): ImageWorkbenchHistoryItem | null {
      const id = String(state.selectedHistoryId ?? "").trim();
      if (!id) return null;
      const item = state.historyItems.find((entry) => entry.id === id) ?? null;
      if (
        !item ||
        item.workbenchStatus === "pending" ||
        item.workbenchStatus === "failed" ||
        item.workbenchStatus === "canceled"
      ) {
        return null;
      }
      return item;
    },
  },
  actions: {
    async syncSettingsFromCache() {
      this.imageSettings = await readImagegenSettings();
      if (this.configured) this.missingConfigurationNoticeShown = false;
    },
    notifyMissingConfigurationOnce() {
      if (this.configured) {
        this.missingConfigurationNoticeShown = false;
        return;
      }
      if (this.missingConfigurationNoticeShown) return;
      this.missingConfigurationNoticeShown = true;
      showToast({
        kind: "warn",
        title: translate("imageWorkbench.notConfiguredTitle"),
        message: translate("imageWorkbench.notConfiguredToastMessage"),
      });
    },
    stopDrag() {
      this.dragActive = false;
    },
    clearMask() {
      this.maskDataUrl = null;
    },
    removeInputImage(id: string) {
      const next = this.inputImages.filter((item) => item.id !== id);
      this.inputImages = next;
      if (next.length === 0) this.maskDataUrl = null;
    },
    async appendFiles(files: FileList | File[]) {
      const picked = Array.from(files)
        .filter((file) => file.type.startsWith("image/"))
        .slice(0, 4);
      const next: InputImage[] = [...this.inputImages];
      for (const file of picked) {
        if (next.length >= 4) break;
        next.push({
          id: makeId(),
          name: file.name || "image",
          dataUrl: await readFileAsDataUrl(file),
        });
      }
      this.inputImages = next;
    },
    async setMaskFromFile(file: File) {
      if (this.inputImages.length === 0) return;
      this.maskDataUrl = await readFileAsDataUrl(file);
    },
    mergeHistoryAndTasks(
      historyItems: ImageGenerationHistoryItem[],
      tasks: ImageGenerationTaskItem[],
    ) {
      const model = this.imageSettings.model || "gpt-image-2";
      const transient = tasks
        .filter((task) => task.status !== "succeeded")
        .map((task) => taskToHistoryItem(task, model));
      this.historyItems = [
        ...transient,
        ...(Array.isArray(historyItems) ? historyItems : []),
      ];
      this.activeGenerationCount = tasks.filter(
        (task) => task.status === "queued" || task.status === "running",
      ).length;
      if (
        this.selectedHistoryId &&
        !this.historyItems.some((item) => item.id === this.selectedHistoryId)
      ) {
        this.selectedHistoryId = "";
      }
    },
    async syncTasks() {
      const startedAt = performance.now();
      try {
        const [taskRes, historyRes] = await Promise.all([
          getImagegenDesktopApi().app.listImageGenerationTasks(),
          getImagegenDesktopApi().app.listImageGenerationHistory(),
        ]);
        this.generationTasks = Array.isArray(taskRes.tasks)
          ? taskRes.tasks
          : [];
        this.mergeHistoryAndTasks(
          Array.isArray(historyRes.items) ? historyRes.items : [],
          this.generationTasks,
        );
        if (this.activeGenerationCount > 0) this.startTaskPolling();
        else this.stopTaskPolling();
        logImageWorkbench("syncTasks ok", {
          tasks: this.generationTasks.length,
          history: Array.isArray(historyRes.items)
            ? historyRes.items.length
            : 0,
          ms: Math.round(performance.now() - startedAt),
        });
      } catch (error: any) {
        logImageWorkbench("syncTasks failed", {
          message: String(error?.message ?? error ?? "unknown error"),
        });
        throw error;
      }
    },
    startTaskPolling() {
      if (this.taskPollingTimer !== null || typeof window === "undefined")
        return;
      this.taskPollingTimer = window.setInterval(() => {
        void this.syncTasks().catch(() => undefined);
      }, 1500);
    },
    stopTaskPolling() {
      if (this.taskPollingTimer === null || typeof window === "undefined")
        return;
      window.clearInterval(this.taskPollingTimer);
      this.taskPollingTimer = null;
    },
    async loadHistory() {
      const loadSeq = this.historyLoadSeq + 1;
      this.historyLoadSeq = loadSeq;
      this.historyLoading = true;
      this.historyErrorText = "";
      const startedAt = performance.now();
      try {
        logImageWorkbench("loadHistory start", { seq: loadSeq });
        const historyRes =
          await getImagegenDesktopApi().app.listImageGenerationHistory();
        if (loadSeq !== this.historyLoadSeq) return;
        this.mergeHistoryAndTasks(
          Array.isArray(historyRes.items) ? historyRes.items : [],
          this.generationTasks,
        );
        this.historyLoading = false;
        logImageWorkbench("history loaded", {
          seq: loadSeq,
          history: Array.isArray(historyRes.items)
            ? historyRes.items.length
            : 0,
          ms: Math.round(performance.now() - startedAt),
        });

        void getImagegenDesktopApi()
          .app.listImageGenerationTasks()
          .then((taskRes) => {
            if (loadSeq !== this.historyLoadSeq) return;
            this.generationTasks = Array.isArray(taskRes.tasks)
              ? taskRes.tasks
              : [];
            this.mergeHistoryAndTasks(
              Array.isArray(historyRes.items) ? historyRes.items : [],
              this.generationTasks,
            );
            if (this.activeGenerationCount > 0) this.startTaskPolling();
            else this.stopTaskPolling();
            logImageWorkbench("tasks merged", {
              seq: loadSeq,
              tasks: this.generationTasks.length,
              active: this.activeGenerationCount,
              ms: Math.round(performance.now() - startedAt),
            });
          })
          .catch((error: any) => {
            logImageWorkbench("task merge failed", {
              seq: loadSeq,
              message: String(error?.message ?? error ?? "unknown error"),
            });
          });
      } catch (error: any) {
        if (loadSeq !== this.historyLoadSeq) return;
        this.historyErrorText = String(
          error?.message ?? error ?? "unknown error",
        );
        logImageWorkbench("loadHistory failed", {
          seq: loadSeq,
          message: this.historyErrorText,
        });
        showToast({
          kind: "error",
          title: translate("imageWorkbench.historyLoadFailed"),
          message: this.historyErrorText,
        });
      } finally {
        if (loadSeq === this.historyLoadSeq) this.historyLoading = false;
      }
    },
    selectHistoryItem(id: string) {
      const normalized = String(id ?? "").trim();
      if (!normalized) return;
      const item = this.historyItems.find((entry) => entry.id === normalized);
      if (
        !item ||
        item.workbenchStatus === "pending" ||
        item.workbenchStatus === "failed" ||
        item.workbenchStatus === "canceled"
      ) {
        return;
      }
      this.selectedHistoryId = normalized;
    },
    async deleteHistoryItem(id: string) {
      const normalized = String(id ?? "").trim();
      if (!normalized) return;
      const item = this.historyItems.find((entry) => entry.id === normalized);
      if (item?.taskId && item.workbenchStatus !== undefined) {
        const previousItems = this.historyItems;
        const previousSelectedHistoryId = this.selectedHistoryId;
        this.historyItems = this.historyItems.filter(
          (entry) => entry.id !== normalized,
        );
        if (this.selectedHistoryId === normalized) this.selectedHistoryId = "";
        try {
          const res =
            await getImagegenDesktopApi().app.deleteImageGenerationTask({
              id: item.taskId,
            });
          this.generationTasks = Array.isArray(res.tasks) ? res.tasks : [];
          await this.syncTasks();
          if (res.deleted) {
            showToast({
              kind: "success",
              title: translate("imageWorkbench.taskDeletedTitle"),
              message: translate("imageWorkbench.taskUpdatedMessage"),
            });
          }
        } catch (error: any) {
          this.historyItems = previousItems;
          this.selectedHistoryId = previousSelectedHistoryId;
          showToast({
            kind: "error",
            title: translate("imageWorkbench.deleteFailedTitle"),
            message: String(error?.message ?? error ?? "unknown error"),
          });
          await this.loadHistory().catch(() => undefined);
        }
        return;
      }
      const previousItems = this.historyItems;
      const previousSelectedHistoryId = this.selectedHistoryId;
      this.historyItems = this.historyItems.filter(
        (entry) => entry.id !== normalized,
      );
      if (this.selectedHistoryId === normalized) this.selectedHistoryId = "";
      try {
        const res =
          await getImagegenDesktopApi().app.deleteImageGenerationHistory({
            id: normalized,
          });
        this.mergeHistoryAndTasks(
          Array.isArray(res.items) ? res.items : [],
          this.generationTasks,
        );
        if (res.deleted) {
          showToast({
            kind: "success",
            title: translate("imageWorkbench.historyDeletedTitle"),
            message: translate("imageWorkbench.historyUpdatedMessage"),
          });
        } else {
          showToast({
            kind: "error",
            title: translate("imageWorkbench.deleteFailedTitle"),
            message: translate("imageWorkbench.historyRecordNotFound"),
          });
          await this.loadHistory();
        }
      } catch (error: any) {
        this.historyItems = previousItems;
        this.selectedHistoryId = previousSelectedHistoryId;
        const message = String(error?.message ?? error ?? "unknown error");
        showToast({
          kind: "error",
          title: translate("imageWorkbench.deleteFailedTitle"),
          message,
        });
        await this.loadHistory().catch(() => undefined);
      }
    },
    async cancelTask(id: string) {
      const normalized = String(id ?? "").trim();
      if (!normalized) return;
      try {
        const res = await getImagegenDesktopApi().app.cancelImageGenerationTask(
          { id: normalized },
        );
        this.generationTasks = Array.isArray(res.tasks) ? res.tasks : [];
        await this.syncTasks();
        if (res.canceled) {
          showToast({
            kind: "success",
            title: translate("imageWorkbench.taskCanceledTitle"),
            message: translate("imageWorkbench.taskUpdatedMessage"),
          });
        }
      } catch (error: any) {
        showToast({
          kind: "error",
          title: translate("imageWorkbench.cancelFailedTitle"),
          message: String(error?.message ?? error ?? "unknown error"),
        });
      }
    },
    async retryTask(id: string) {
      const normalized = String(id ?? "").trim();
      if (!normalized) return;
      try {
        const res = await getImagegenDesktopApi().app.retryImageGenerationTask({
          id: normalized,
        });
        this.generationTasks = Array.isArray(res.tasks) ? res.tasks : [];
        await this.syncTasks();
        showToast({
          kind: "success",
          title: translate("imageWorkbench.requeuedTitle"),
          message: translate("imageWorkbench.requeuedMessage"),
        });
      } catch (error: any) {
        showToast({
          kind: "error",
          title: translate("imageWorkbench.retryFailedTitle"),
          message: String(error?.message ?? error ?? "unknown error"),
        });
      }
    },
    async generate() {
      await this.syncSettingsFromCache();
      if (!this.prompt.trim()) {
        this.errorText = translate("imageWorkbench.promptRequired");
        showToast({
          kind: "error",
          title: translate("imageWorkbench.cannotGenerateTitle"),
          message: this.errorText,
        });
        return;
      }
      if (!this.configured) {
        this.errorText = translate("imageWorkbench.notConfiguredError");
        showToast({
          kind: "error",
          title: translate("imageWorkbench.cannotGenerateTitle"),
          message: this.errorText,
        });
        return;
      }
      this.errorText = "";
      const inputImages = this.inputImages.map((item) => ({
        dataUrl: item.dataUrl,
        name: item.name,
      }));
      const mode: ImageWorkbenchMode =
        inputImages.length > 0 ? "edit" : "generate";
      const args: ImageGenerationGenerateArgs = {
        workspacePath: getImagegenWorkspacePath() || null,
        prompt: this.prompt.trim(),
        inputImages: mode === "edit" ? inputImages : null,
        maskDataUrl: mode === "edit" ? this.maskDataUrl : null,
        n: 1,
        size: "auto",
        quality: this.quality,
        outputFormat: "auto",
        background: "auto",
        moderation: "auto",
        outputCompression: sanitizeCompression(this.outputCompression),
      };
      this.selectedHistoryId = "";
      try {
        const res =
          await getImagegenDesktopApi().app.submitImageGenerationTask(args);
        this.generationTasks = Array.isArray(res.tasks) ? res.tasks : [];
        await this.syncTasks();
        this.startTaskPolling();
        showToast({
          kind: "success",
          title: translate("imageWorkbench.queuedTitle"),
          message: translate("imageWorkbench.queuedMessage"),
        });
      } catch (error: any) {
        this.errorText = String(error?.message ?? error ?? "unknown error");
        showToast({
          kind: "error",
          title: translate("imageWorkbench.submitFailedTitle"),
          message: this.errorText,
        });
      }
    },
  },
});
