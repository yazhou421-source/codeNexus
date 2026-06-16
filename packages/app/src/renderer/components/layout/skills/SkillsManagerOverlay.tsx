import { Blocks } from "lucide-react";
import { useEffect, useState } from "react";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import type { SkillState } from "../../../domain/types";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useSkillsStore } from "../../../stores/skills.store";
import { useSkillsUiStore } from "../../../stores/skillsUi.store";
import SkillsList from "./SkillsList";

type SkillsManagerOverlayProps = {
  className?: string;
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
      return `暂无可用技能（errors=${skillsStore.parseErrors.length}）`;
    }
    return "暂无可用技能";
  }
  return "";
}

export default function SkillsManagerOverlay({ className }: SkillsManagerOverlayProps) {
  const runtime = getRuntimeOrchestrator();
  const runtimeStore = useRuntimeStore();
  const skillsStore = useSkillsStore();
  const skillsUiStore = useSkillsUiStore();
  const [pendingPath, setPendingPath] = useState("");

  useEffect(() => {
    if (!skillsUiStore.managerOpen) return;
    const onWindowKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") skillsUiStore.closeManager();
    };
    window.addEventListener("keydown", onWindowKeydown);
    return () => window.removeEventListener("keydown", onWindowKeydown);
  }, [skillsUiStore]);

  useEffect(() => {
    if (skillsUiStore.managerOpen && runtimeStore.serverId && skillsStore.loadState === "idle") {
      void runtime.refreshSkills(false);
    }
  }, [runtime, runtimeStore.serverId, skillsStore.loadState, skillsUiStore.managerOpen]);

  if (!skillsUiStore.managerOpen) return null;

  const canRefresh = Boolean(runtimeStore.serverId && runtimeStore.workspacePath && skillsStore.loadState !== "loading");
  const currentStateText = stateText(runtimeStore, skillsStore);

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
    <section className={["skills-manager-page", "app-scrollbar", className].filter(Boolean).join(" ")} aria-label="技能管理器（Skills）">
      <div className="skills-manager-sticky">
        <header className="skills-manager-head">
          <div className="skills-manager-title-row">
            <Blocks className="skills-manager-title-icon" aria-hidden="true" />
            <h2 className="skills-manager-title">技能管理（Skills）</h2>
          </div>

          <div className="skills-manager-head-actions">
            <button className="btn-mini" type="button" disabled={!canRefresh} onClick={() => void runtime.refreshSkills(true)}>
              刷新
            </button>
            <button className="btn-mini" type="button" onClick={() => skillsUiStore.closeManager()}>
              返回
            </button>
          </div>
        </header>
      </div>

      <div className="skills-manager-body">
        <SkillsList
          items={skillsStore.items}
          pendingPath={pendingPath}
          stateText={currentStateText}
          emptyText="未找到匹配技能"
          mode="manager"
          onToggleSkill={toggleSkill}
        />
      </div>
    </section>
  );
}
