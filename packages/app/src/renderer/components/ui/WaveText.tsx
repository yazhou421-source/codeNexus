import type { CSSProperties, HTMLAttributes } from "react";
import { useEffect, useMemo, useState } from "react";

export type WaveTextProps = HTMLAttributes<HTMLSpanElement | HTMLDivElement> & {
  text?: string;
  enabled?: boolean;
  color?: string;
  charDelaySec?: number;
  charAnimDurationSec?: number;
  pauseSec?: number;
  cycleMaxChars?: number;
  minOpacity?: number;
  maxOpacity?: number;
  as?: "span" | "div";
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export default function WaveText({
  text = "",
  enabled = true,
  color = "var(--accent)",
  charDelaySec = 0.12,
  charAnimDurationSec = 1,
  pauseSec = 0,
  cycleMaxChars = 0,
  minOpacity = 0.25,
  maxOpacity = 1,
  as = "span",
  style,
  className,
  ...props
}: WaveTextProps) {
  const [phase, setPhase] = useState(0);
  const chars = useMemo(() => Array.from(String(text ?? "")), [text]);
  const waveCharCount = useMemo(() => {
    const maxChars = Math.floor(Number(cycleMaxChars) || 0);
    if (maxChars <= 0) return chars.length;
    return Math.min(chars.length, Math.max(1, maxChars));
  }, [chars.length, cycleMaxChars]);

  useEffect(() => {
    if (!enabled || !String(text ?? "").trim()) return undefined;
    const delayMs = Math.max(0, Number(charDelaySec) || 0) * 1000;
    const animMs = Math.max(100, (Number(charAnimDurationSec) || 1) * 1000);
    const pauseMs = Math.max(0, Number(pauseSec) || 0) * 1000;
    const cycleLen = Math.max(1, waveCharCount);
    const totalMs = Math.max(0, (cycleLen - 1) * delayMs) + animMs + pauseMs;
    const timer = window.setTimeout(() => setPhase((value) => value + 1), totalMs);
    return () => window.clearTimeout(timer);
  }, [charAnimDurationSec, charDelaySec, enabled, pauseSec, text, waveCharCount, phase]);

  const Component = as;
  const rootStyle = {
    ...style,
    "--wave-color": String(color ?? "var(--accent)"),
    "--wave-min-op": String(clamp01(Number(minOpacity))),
    "--wave-max-op": String(clamp01(Number(maxOpacity))),
    "--wave-dur": `${Math.max(0.1, Number(charAnimDurationSec) || 1)}s`,
  } as CSSProperties;

  return (
    <Component
      {...props}
      className={["break-words whitespace-pre-wrap text-[color:var(--wave-color)]", className]
        .filter(Boolean)
        .join(" ")}
      style={rootStyle}
      aria-label={String(text ?? "")}
    >
      {chars.map((ch, index) => {
        if (ch === "\n") return <br key={`c:${index}`} aria-hidden="true" />;
        const isStatic = !enabled || index >= waveCharCount;
        const charStyle = isStatic
          ? ({ animation: "none", opacity: "var(--wave-max-op)" } as CSSProperties)
          : ({
              animationName: phase % 2 === 0 ? "wave-text-opacity-a" : "wave-text-opacity-b",
              animationDuration: "var(--wave-dur)",
              animationTimingFunction: "ease-in-out",
              animationIterationCount: 1,
              animationDelay: `${index * Math.max(0, Number(charDelaySec) || 0)}s`,
              animationFillMode: "both",
            } as CSSProperties);
        return (
          <span key={`c:${index}`} className="inline-block opacity-[var(--wave-min-op)]" aria-hidden="true" style={charStyle}>
            {ch}
          </span>
        );
      })}
    </Component>
  );
}
