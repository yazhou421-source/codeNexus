import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { useCodexProfilesStore } from "../../../stores/codexProfiles.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import SelectDropdown from "../../ui/SelectDropdown";

type CodexProfileSwitchProps = {
  className?: string;
};

export default function CodexProfileSwitch({ className }: CodexProfileSwitchProps) {
  const { t } = useTranslation();
  const runtime = getRuntimeOrchestrator();
  const profilesStore = useCodexProfilesStore();
  const runtimeStore = useRuntimeStore();
  const [switchingId, setSwitchingId] = useState("");
  const profileOptions = useMemo(
    () => profilesStore.profiles.map((profile) => ({ value: profile.id, label: profile.name })),
    [profilesStore.profiles],
  );
  const selectedValue = String(profilesStore.activeProfileId ?? "");
  const selectDisabled = !runtimeStore.serverId || profilesStore.profiles.length === 0 || Boolean(switchingId);

  useEffect(() => {
    if (profilesStore.loadState === "idle") void profilesStore.refresh();
  }, [profilesStore]);

  async function onSelectProfile(profileId: string) {
    const id = String(profileId ?? "").trim();
    if (!id || switchingId === id) return;
    setSwitchingId(id);
    try {
      await runtime.applyCodexProfile(id);
    } finally {
      setSwitchingId("");
    }
  }

  return (
    <div className={["codex-profile-switch", className].filter(Boolean).join(" ")}>
      <SelectDropdown
        id="codex-profile-select"
        className="codex-profile-switch__select"
        modelValue={selectedValue}
        options={profileOptions}
        disabled={selectDisabled}
        ariaLabel={t("codexProfileSwitch.aria")}
        placeholder={t("codexProfileSwitch.unselected")}
        minPopoverWidth={180}
        onValueChange={(value) => void onSelectProfile(value)}
      />
    </div>
  );
}
