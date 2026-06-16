import { Blocks } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import type { SkillState } from "../../../domain/types";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useSkillsStore } from "../../../stores/skills.store";
import { useSkillsUiStore } from "../../../stores/skillsUi.store";
import SkillsList from "./SkillsList";

type SkillsPanelProps = {
  className?: string;
  onOpenManager?: () => void;
};

function stateText(runtimeStore: ReturnType<typeof useRuntimeStore>, skillsStore: ReturnType<typeof useSkillsStore>) {
  if (!runtimeStore.serverId) return "未连接服务";
  if (!runtimeStore.workspacePath) return "未选择工作区";
  if (skillsStore.loadState === "loading") return "加载中…";
  if (skillsStore.loadState === "error") {
    return skillsStore.errorText
      ? `加载失败：${skillsStore.errorText}`
      : "加载失败";
  }
  if (skillsStore.items.length === 0) {
    if (skillsStore.parseErrors.length > 0) {
      return `暂无可用技能（错误 ${skillsStore.parseErrors.length} 项）`;
    }
    return "暂无可用技能";
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
            <span className="skills-panel-title-text">技能（Skills）</span>
            <span className="skills-panel-title-subtext mono dim">内置能力开关</span>
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
            管理器
          </button>
          <button id="btn-refresh-skills" className="btn-mini" type="button" disabled={!canRefresh} onClick={() => void runtime.refreshSkills(true)}>
            刷新
          </button>
        </div>
      </header>

      {skillsStore.items.length > 0 && !currentStateText ? (
        <div className="skills-panel-meta mono dim">
          <span>{`共 ${skillsStore.items.length} 项`}</span>
          <span>{`已启用 ${enabledCount} 项`}</span>
        </div>
      ) : null}

      <SkillsList
        items={skillsStore.items}
        pendingPath={pendingPath}
        stateText={currentStateText}
        emptyText="暂无可用技能"
        mode="compact"
        onToggleSkill={toggleSkill}
      />
    </section>
  );
}
