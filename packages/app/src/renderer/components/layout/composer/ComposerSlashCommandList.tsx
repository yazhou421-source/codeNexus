import type { HTMLAttributes } from "react";
import { useTranslation } from "react-i18next";

export type SlashCommandListItem = {
  id: string;
  code: string;
  title: string;
  hint?: string;
  disabled?: boolean;
  disabledHint?: string;
};

export default function ComposerSlashCommandList({
  commands,
  items,
  activeIndex = 0,
  onHover,
  onSelect,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  commands?: SlashCommandListItem[];
  items?: SlashCommandListItem[];
  activeIndex?: number;
  onHover?: (index: number) => void;
  onSelect?: (commandId: string) => void;
}) {
  const { t } = useTranslation();
  const list = Array.isArray(commands) ? commands : Array.isArray(items) ? items : [];
  return (
    <div {...props} className={["composer-slash-switch", className].filter(Boolean).join(" ")}>
      {list.length === 0 ? (
        <div className="composer-slash-list composer-slash-list--empty" aria-live="polite">
          <div className="composer-slash-option composer-slash-option--empty" aria-disabled="true">
            <span className="composer-slash-empty-text mono dim">{t("composer.slashNoCommands")}</span>
          </div>
        </div>
      ) : (
        <div className="composer-slash-list" role="listbox">
          {list.map((command, index) => (
            <button
              key={command.id}
              className={["composer-slash-option group", index === activeIndex && !command.disabled ? "is-active" : ""]
                .filter(Boolean)
                .join(" ")}
              type="button"
              role="option"
              aria-selected={index === activeIndex ? "true" : "false"}
              disabled={Boolean(command.disabled)}
              onMouseEnter={() => onHover?.(index)}
              onClick={() => onSelect?.(command.id)}
            >
              <span className="composer-slash-code mono">/{command.code}</span>
              <span className="composer-slash-title">{command.title}</span>
              {command.disabled && command.disabledHint ? (
                <span className="composer-slash-hint mono">{command.disabledHint}</span>
              ) : command.hint ? (
                <span className="composer-slash-hint mono">{command.hint}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
