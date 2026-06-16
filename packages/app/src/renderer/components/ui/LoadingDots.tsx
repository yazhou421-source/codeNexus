import type { HTMLAttributes, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

export type LoadingDotsProps = HTMLAttributes<HTMLSpanElement | HTMLDivElement> & {
  baseText?: string;
  intervalMs?: number;
  maxDots?: number;
  as?: "span" | "div";
  ariaLabel?: string;
  prefix?: ReactNode;
};

export default function LoadingDots({
  baseText = "",
  intervalMs = 350,
  maxDots = 3,
  as = "span",
  ariaLabel = "",
  prefix,
  children,
  ...props
}: LoadingDotsProps) {
  const [dots, setDots] = useState(0);
  const dotCount = Math.max(0, Math.round(Number(maxDots) || 3));
  const Component = as;

  useEffect(() => {
    setDots(0);
    const timer = window.setInterval(() => {
      setDots((value) => (value + 1) % (dotCount + 1));
    }, Math.max(80, Math.round(Number(intervalMs) || 350)));
    return () => window.clearInterval(timer);
  }, [baseText, dotCount, intervalMs]);

  const dotsText = useMemo(() => ".".repeat(Math.max(0, dots)), [dots]);
  const labelText = String(ariaLabel ?? "").trim() || `${baseText}${dotsText}`;

  return (
    <Component {...props} aria-label={labelText}>
      {prefix}
      {children}
      <span>{baseText}</span>
      <span aria-hidden="true">{dotsText}</span>
    </Component>
  );
}
