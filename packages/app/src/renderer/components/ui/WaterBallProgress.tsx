import type { CSSProperties, HTMLAttributes } from "react";

export type WaterBallProgressProps = HTMLAttributes<HTMLDivElement> & {
  percent?: number;
  size?: number;
  level?: string;
  animated?: boolean;
  ariaLabel?: string;
};

type ProgressLevel = "normal" | "warn" | "high" | "critical";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const toFinite = (value: unknown, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

function normalizeLevel(level: string | undefined): ProgressLevel {
  const raw = String(level ?? "").trim().toLowerCase();
  if (raw === "warn" || raw === "high" || raw === "critical") return raw;
  return "normal";
}

export default function WaterBallProgress({
  percent = 0,
  size,
  level,
  animated = true,
  ariaLabel,
  className,
  style,
  ...props
}: WaterBallProgressProps) {
  const value = clamp(toFinite(percent, 0), 0, 100);
  const sizeValue = size == null ? 32 : Math.round(Math.max(16, toFinite(size, 32)));
  const normalizedLevel = normalizeLevel(level);
  const rootStyle = {
    ...style,
    "--progress-size": `${sizeValue}px`,
    "--progress-value": `${value}%`,
    "--progress-font-size": `${clamp(Math.round(sizeValue * 0.25), 7, 12)}px`,
  } as CSSProperties;

  return (
    <div
      {...props}
      className={["ui-waterball-progress", `is-${normalizedLevel}`, animated ? "" : "is-static", className]
        .filter(Boolean)
        .join(" ")}
      style={rootStyle}
      role="img"
      aria-label={ariaLabel || `Progress ${Math.round(value)}%`}
    >
      <span className="ui-waterball-progress__ring" aria-hidden="true">
        <span className="ui-waterball-progress__value">{Math.round(value)}</span>
      </span>
    </div>
  );
}
