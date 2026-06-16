import type { RuntimeMode } from "@codenexus/shared/localSettings";

type ModeSwitchButtonProps = {
  runtimeMode: RuntimeMode | null;
  onSwitch: () => void;
  className?: string;
};

// 唯一的跨页控件：打开运行模式选择器。codex 与 custom 两页共用。
export default function ModeSwitchButton({ runtimeMode, onSwitch, className }: ModeSwitchButtonProps) {
  const label = runtimeMode === "custom" ? "自定义模式" : "Codex 模式";
  return (
    <button
      className={["mode-switch-button", "mono", className].filter(Boolean).join(" ")}
      type="button"
      title="切换运行模式"
      onClick={onSwitch}
    >
      {label}
    </button>
  );
}
