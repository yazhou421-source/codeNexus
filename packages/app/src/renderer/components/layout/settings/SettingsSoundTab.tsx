import { useEffect, useMemo } from "react";
import { playNotificationSoundOnce } from "../../../features/notificationSound/player";
import { translate } from "../../../i18n/translate";
import { useNotificationSoundStore } from "../../../stores/notificationSound.store";
import SelectDropdown from "../../ui/SelectDropdown";

export default function SettingsSoundTab() {
  const soundStore = useNotificationSoundStore();
  const dropdownOptions = useMemo(
    () => soundStore.available.map((item) => ({ value: item.id, label: item.label })),
    [soundStore.available]
  );
  const controlsDisabled = soundStore.loadState === "loading" || soundStore.available.length === 0;
  const statusText =
    soundStore.loadState === "idle"
      ? ""
      : soundStore.loadState === "loading"
        ? translate("settingsSound.loading")
        : soundStore.loadState === "error"
          ? soundStore.errorText
            ? translate("settingsSound.loadFailedWithMessage", { message: soundStore.errorText })
            : translate("settingsSound.loadFailed")
          : soundStore.available.length === 0
            ? translate("settingsSound.noBuiltInSounds")
            : "";

  useEffect(() => {
    if (soundStore.loadState === "idle") void soundStore.refreshAvailable();
  }, [soundStore.loadState]);

  const preview = async () => {
    const id = String(soundStore.selectedId ?? "").trim();
    if (!id) return;
    await playNotificationSoundOnce({ soundId: id, force: true, volumePercent: soundStore.volumePercent });
  };

  return (
    <section className="settings-card" aria-label={translate("settingsSound.aria")}>
      <header className="settings-card-head">
        <div className="settings-card-title">{translate("settingsSound.title")}</div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <button
            id="btn-settings-sound-preview"
            className="btn-mini"
            type="button"
            disabled={controlsDisabled}
            onClick={() => void preview()}
          >
            {translate("settingsSound.preview")}
          </button>
        </div>
      </header>
      <div className="settings-card-body">
        <div className="settings-grid">
          <label className="settings-row">
            <span className="context-label dim">{translate("settingsSound.sound")}</span>
            <SelectDropdown
              id="sel-settings-notification-sound"
              className="context-input mono w-full"
              modelValue={soundStore.selectedId}
              disabled={controlsDisabled}
              options={dropdownOptions}
              minPopoverWidth={260}
              onUpdate:modelValue={(value) => {
                const next = String(value ?? "").trim();
                if (next) soundStore.setSelectedId(next, { save: true });
              }}
            />
          </label>
          {statusText ? <div className="dim text-[12px] leading-[1.25]">{statusText}</div> : null}
          <label className="settings-row">
            <span className="context-label dim">{translate("settingsSound.volume")}</span>
            <div className="settings-volume">
              <input
                id="rng-settings-notification-sound-volume"
                className="settings-volume-slider"
                type="range"
                min="0"
                max="100"
                step="1"
                value={soundStore.volumePercent}
                onInput={(event) => soundStore.setVolumePercent(Number(event.currentTarget.value), { save: false })}
                onChange={(event) => soundStore.setVolumePercent(Number(event.currentTarget.value), { save: true })}
              />
              <span className="mono dim settings-volume-value">{soundStore.volumePercent}%</span>
            </div>
          </label>
          <div className="dim text-[12px] leading-[1.25]">{translate("settingsSound.description")}</div>
        </div>
      </div>
    </section>
  );
}
