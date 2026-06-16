import { Cpu, Heart, Moon, Sun, Terminal } from "lucide-react";
import { useMemo, type MouseEvent } from "react";
import { APP_THEME_ORDER, useThemeStore, type AppThemeName } from "../../../stores/theme.store";

type TopBarThemeSwitchProps = {
  className?: string;
};

function iconForTheme(theme: AppThemeName) {
  if (theme === "light") return Sun;
  if (theme === "pink") return Heart;
  if (theme === "tech") return Cpu;
  if (theme === "hacker") return Terminal;
  return Moon;
}

export default function TopBarThemeSwitch({ className }: TopBarThemeSwitchProps) {
  const themeStore = useThemeStore();
  const Icon = iconForTheme(themeStore.theme);

  const localizedThemeLabel = (theme: AppThemeName): string => {
    if (theme === "light") return "浅色";
    if (theme === "pink") return "少女粉";
    if (theme === "tech") return "科技";
    if (theme === "hacker") return "黑客";
    return "深色";
  };

  const nextThemeLabel = useMemo(() => {
    const currentIndex = APP_THEME_ORDER.indexOf(themeStore.theme);
    const nextTheme = currentIndex >= 0 ? APP_THEME_ORDER[(currentIndex + 1) % APP_THEME_ORDER.length] : APP_THEME_ORDER[0];
    return localizedThemeLabel(nextTheme);
  }, [themeStore.theme]);

  const themeLabel = localizedThemeLabel(themeStore.theme);
  const themeAriaLabel = `切换主题，当前${themeLabel}，下一个${nextThemeLabel}`;

  function onToggleTheme(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    themeStore.cycleTheme(APP_THEME_ORDER, {
      transitionOrigin: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
    });
  }

  return (
    <button
      id="btn-topbar-theme"
      className={[
        "topbar-theme-switch",
        !themeStore.isLight ? "is-dark" : "",
        themeStore.theme === "tech" ? "is-tech" : "",
        themeStore.theme === "hacker" ? "is-hacker" : "",
        themeStore.theme === "pink" ? "is-pink" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      type="button"
      aria-label={themeAriaLabel}
      onClick={onToggleTheme}
    >
      <span className="topbar-theme-switch-icon-wrap" aria-hidden="true">
        <Icon key={themeStore.theme} className="topbar-theme-switch-icon" />
      </span>
    </button>
  );
}
