import { defineStore } from "./zustandCompat";
import type { NotificationSoundItem } from "@codenexus/shared/ipc";
import { codexDesktop } from "../api/codexDesktopClient";
import { getCachedUserLocalSettings, patchUserLocalSettings } from "../domain/localSettings";

export function readConfiguredNotificationSoundId(): string {
  return String(getCachedUserLocalSettings().settings.notification.selectedSoundId ?? "").trim();
}

export function readConfiguredNotificationSoundVolumePercent(): number {
  const n = Number(getCachedUserLocalSettings().settings.notification.soundVolumePercent);
  if (!Number.isFinite(n)) return 70;
  const rounded = Math.round(n);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

export type NotificationSoundLoadState = "idle" | "loading" | "ready" | "error";

export const useNotificationSoundStore = defineStore("notificationSound", {
  state: () => ({
    loadState: "idle" as NotificationSoundLoadState,
    errorText: "" as string,
    available: [] as NotificationSoundItem[],
    selectedId: "" as string,
    volumePercent: 70 as number,
  }),
  getters: {
    selectedLabel(state): string {
      const hit = state.available.find((x) => x.id === state.selectedId);
      return hit?.label ?? "";
    },
  },
  actions: {
    initLocalSettings() {
      const cached = getCachedUserLocalSettings();
      this.selectedId = String(cached.settings.notification.selectedSoundId ?? "").trim();
      this.volumePercent = readConfiguredNotificationSoundVolumePercent();
      if (!cached.exists) {
        void patchUserLocalSettings({
          notification: {
            selectedSoundId: this.selectedId || null,
            soundVolumePercent: this.volumePercent,
          },
        });
      }
    },
    setSelectedId(id: string, opts?: { save?: boolean }) {
      const shouldSave = opts?.save ?? true;
      const next = String(id ?? "").trim();
      this.selectedId = next;
      if (shouldSave) {
        void patchUserLocalSettings({ notification: { selectedSoundId: next || null } });
      }
    },
    setVolumePercent(nextValue: number, opts?: { save?: boolean }) {
      const shouldSave = opts?.save ?? true;
      const raw = Number(nextValue);
      if (!Number.isFinite(raw)) return;
      const clamped = Math.max(0, Math.min(100, Math.round(raw)));
      this.volumePercent = clamped;
      if (!shouldSave) return;
      void patchUserLocalSettings({ notification: { soundVolumePercent: clamped } });
    },
    async refreshAvailable() {
      if (this.loadState === "loading") return;
      this.loadState = "loading";
      this.errorText = "";
      try {
        const res = await codexDesktop.app.listNotificationSounds();
        const items = Array.isArray(res?.items) ? res.items : [];
        this.available = items;

        const selected = String(this.selectedId ?? "").trim();
        const hasSelected = selected && items.some((x) => x.id === selected);
        if (!hasSelected) {
          const fallback = items[0]?.id ?? "";
          this.setSelectedId(fallback, { save: true });
        }
        this.loadState = "ready";
      } catch (e: any) {
        this.loadState = "error";
        this.errorText = String(e?.message ?? e ?? "unknown error");
      }
    },
  },
});
