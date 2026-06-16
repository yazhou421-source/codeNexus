import { Blocks } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import type { SkillState } from "../../../domain/types";
import { translate } from "../../../i18n/translate";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useSkillsStore } from "../../../stores/skills.store";
import { useSkillsUiStore } from "../../../stores/skillsUi.store";
import SkillsList from "./SkillsList";

type SkillsPanelProps = {
  className?: string;
  onOpenManager?: () => void;
};

function stateText(runtimeStore: ReturnType<typeof useRuntimeStore>, skillsStore: ReturnType<typeof useSkillsStore>) {
  if (!runtimeStore.serverId) return translate("skills.disconnected");
  if (!runtimeStore.workspacePath) return translate("skills.noWorkspace");
  if (skillsStore.loadState === "loading") return translate("skills.loading");
  if (skillsStore.loadState === "error") {
    return skillsStore.errorText
      ? translate("skills.loadFailedWithMessage", { message: skillsStore.errorText })
      : translate("skills.loadFailed");
  }
  if (skillsStore.items.length === 0) {
    if (skillsStore.parseErrors.length > 0) {
      return translate("skills.emptyWithErrors", { count: skillsStore.parseErrors.length });
    }
    return translate("skills.empty");
  }
  return "";
}

export default function SkillsPanel({ className, onOpenManager }: SkillsPanelProps) {
  const runtime = getRuntimeOrchestrator();
  const runtimeStore = useRuntimeStore();
  const skillsStore = useSkillsStore();
  const skillsUiStore = useSkillsUiStore();
  const [pendingPath, setPendingPath] = useState("");
  const enabledCount = useMemo(() => skillsStore.items.filter((item) => item.enabled).length, [skillsStore.items]);
  const canRefresh = Boolean(runtimeStore.serverId && runtimeStore.workspacePath && skillsStore.loadState !== "loading");
  const canOpenManager = Boolean(runtimeStore.serverId || runtimeStore.workspacePath || skillsStore.items.length > 0);
  const currentStateText = stateText(runtimeStore, skillsStore);

  useEffect(() => {
    if (runtimeStore.serverId) void runtime.refreshSkills(false);
  }, [runtime, runtimeStore.serverId]);

  const toggleSkill = async ({ skill, enabled }: { skill: SkillState; enabled: boolean }) => {
    const path = String(skill.path ?? "").trim();
    if (!path || !skill.configurable || pendingPath === path) return;
    setPendingPath(path);
    try {
      await runtime.toggleSkill(path, enabled);
    } finally {
      setPendingPath("");
    }
  };

  return (
    <section className={["skills-panel", className].filter(Boolean).join(" ")}>
      <header className="skills-panel-head">
        <div className="skills-panel-title">
          <Blocks className="skills-panel-icon" aria-hidden="true" />
          <div className="skills-panel-title-copy">
            <span className="skills-panel-title-text">{translate("skills.panelTitle")}</span>
            <span className="skills-panel-title-subtext mono dim">{translate("skills.panelSubtitle")}</span>
          </div>
        </div>
        <div className="skills-panel-actions">
          <button
            id="btn-open-skills-manager"
            className="btn-mini"
            type="button"
            disabled={!canOpenManager}
            onClick={() => (onOpenManager ? onOpenManager() : skillsUiStore.openManager())}
          >
            {translate("skills.manager")}
          </button>
          <button id="btn-refresh-skills" className="btn-mini" type="button" disabled={!canRefresh} onClick={() => void runtime.refreshSkills(true)}>
            {translate("skills.refresh")}
          </button>
        </div>
      </header>

      {skillsStore.items.length > 0 && !currentStateText ? (
        <div className="skills-panel-meta mono dim">
          <span>{translate("skills.totalCount", { count: skillsStore.items.length })}</span>
          <span>{translate("skills.enabledCount", { count: enabledCount })}</span>
        </div>
      ) : null}

      <SkillsList
        items={skillsStore.items}
        pendingPath={pendingPath}
        stateText={currentStateText}
        emptyText={translate("skills.empty")}
        mode="compact"
        onToggleSkill={toggleSkill}
      />
    </section>
  );
}
