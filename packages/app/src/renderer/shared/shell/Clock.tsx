import { useEffect, useState } from "react";

function formatMinute(value: number) {
  const dt = new Date(value);
  const yyyy = String(dt.getFullYear());
  const MM = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
}

// 共享时钟：分钟级自校时刷新。codex 与 custom 两页底栏共用。
export default function Clock({ className }: { className?: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let timerId: number | null = null;
    const tick = () => {
      setNow(Date.now());
      timerId = window.setTimeout(tick, Math.max(16, 60_000 - (Date.now() % 60_000) + 16));
    };
    tick();
    return () => {
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, []);

  return (
    <div className={["mono", "dim", className].filter(Boolean).join(" ")} aria-label={`当前时间 ${formatMinute(now)}`}>
      {formatMinute(now)}
    </div>
  );
}
