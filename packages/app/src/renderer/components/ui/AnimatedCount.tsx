import type { CSSProperties, HTMLAttributes } from "react";

export type AnimatedCountProps = HTMLAttributes<HTMLSpanElement> & {
  value?: number;
  duration?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function AnimatedCount({ value = 0, duration = 180, className, style, ...props }: AnimatedCountProps) {
  const normalizedValue = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const normalizedDuration = clamp(Math.round(duration), 80, 420);
  const digits = String(normalizedValue).split("");
  const rootStyle = { ...style, "--count-duration": `${normalizedDuration}ms` } as CSSProperties;

  return (
    <span {...props} className={["chat-animated-count", className].filter(Boolean).join(" ")} style={rootStyle}>
      {digits.map((char, index) => (
        <span key={`${digits.length - index - 1}:${char}:${index}`} className="chat-count-digit-cell" aria-hidden="true">
          <span className="chat-count-digit-value" key={char}>
            {char}
          </span>
        </span>
      ))}
      <span className="sr-only">{normalizedValue}</span>
    </span>
  );
}
