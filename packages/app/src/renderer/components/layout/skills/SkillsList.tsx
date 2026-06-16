import { ChevronDown } from "lucide-react";
import type { SkillState } from "../../../domain/types";
import { translate } from "../../../i18n/translate";
import { useSkillsUiStore } from "../../../stores/skillsUi.store";

type SkillsListProps = {
  items?: SkillState[];
  mode?: "compact" | "manager";
  pendingPath?: string;
  stateText?: string;
  emptyText?: string;
  onToggleSkill?: (payload: { skill: SkillState; enabled: boolean }) => void;
  className?: string;
};

function skillKey(skill: SkillState) {
  return String(skill.path ?? "").trim() || String(skill.name ?? "").trim() || "unknown-skill";
}

function previewText(skill: SkillState) {
  const description = String(skill.description ?? "").trim();
  if (description) return description;
  if (!skill.configurable) return translate("skills.fixedPreview");
  return skill.enabled ? translate("skills.enabledPreview") : translate("skills.disabledPreview");
}

export default function SkillsList({
  items = [],
  mode = "compact",
  pendingPath = "",
  stateText = "",
  emptyText = translate("skills.empty"),
  onToggleSkill,
  className,
}: SkillsListProps) {
  const skillsUiStore = useSkillsUiStore();
  const modeClass = `skill-mode-${mode}`;

  if (stateText) return <div className={["skills-list", "skills-list--message", "dim", className].filter(Boolean).join(" ")}>{stateText}</div>;
  if (items.length === 0) return <div className={["skills-list", "skills-list--message", "dim", className].filter(Boolean).join(" ")}>{emptyText}</div>;

  return (
    <div className={["skills-list", modeClass, className].filter(Boolean).join(" ")}>
      {items.map((skill) => {
        const key = skillKey(skill);
        const open = skillsUiStore.isExpanded(key);
        const pending = pendingPath === String(skill.path ?? "");
        return (
          <article
            key={key}
            className={[
              "skill-details",
              modeClass,
              open ? "is-open" : "",
              !skill.configurable ? "is-readonly" : "",
              pending ? "is-pending" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className={["skill-summary", modeClass].join(" ")}>
              <label className="skill-switch">
                <input
                  className="skill-switch-input"
                  type="checkbox"
                  checked={skill.enabled}
                  disabled={!skill.configurable || pending}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onToggleSkill?.({ skill, enabled: event.currentTarget.checked })}
                />
                <span className="skill-switch-track" aria-hidden="true">
                  <span className="skill-switch-thumb" />
                </span>
              </label>

              <div className="skill-summary-main">
                <div className="skill-summary-topline">
                  <div className="skill-title-wrap">
                    <div className="name">{skill.name}</div>
                    {mode === "manager" ? (
                      <div className="skill-badge-row">
                        <span className={`skill-status-pill${skill.enabled ? " is-enabled" : " is-disabled"}`}>
                          {skill.enabled ? translate("skills.enabled") : translate("skills.disabled")}
                        </span>
                        <span className="skill-meta-pill">{skill.configurable ? translate("skills.configurable") : translate("skills.fixed")}</span>
                      </div>
                    ) : null}
                  </div>

                  {skill.description || skill.path ? (
                    <button
                      className="skill-summary-toggle"
                      type="button"
                      aria-label={open ? translate("skills.collapseDetails") : translate("skills.expandDetails")}
                      onClick={() => skillsUiStore.toggleExpanded(key)}
                    >
                      <ChevronDown className={`skill-summary-toggle-icon${open ? " open" : ""}`} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>

                {mode === "manager" ? <div className="skill-preview">{previewText(skill)}</div> : null}
                {skill.path ? <div className="skill-path">{skill.path}</div> : null}
              </div>
            </div>

            {open ? (
              <div className={["skill-body", modeClass].join(" ")}>
                {skill.description ? (
                  <section className="skill-info-block">
                    <div className="skill-info-label mono">{translate("skills.description")}</div>
                    <div className="skill-desc">{skill.description}</div>
                  </section>
                ) : null}
                {skill.path ? (
                  <section className="skill-info-block">
                    <div className="skill-info-label mono">{translate("skills.path")}</div>
                    <div className="skill-path skill-path--body">{skill.path}</div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
