import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { renderMarkdownToSafeHtml } from "../../features/timeline/markdownRenderer";
import AgentMarkdownContent from "./AgentMarkdownContent";

type ParsedMarkdownPlan = {
  title: string;
  description: string;
  body: string;
};

type HeadingHit = {
  level: number;
  lineIndex: number;
  title: string;
};

type MarkdownPlanOutputCardProps = {
  rawText?: string;
  markdown?: string;
  text?: string;
  forceCollapsed?: boolean;
  headerActions?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

function stripInlineMarkdown(value: string): string {
  return String(value ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isFenceLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}

function headingFromLine(line: string): { level: number; title: string } | null {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
  if (!match) return null;
  const title = stripInlineMarkdown(match[2]);
  if (!title) return null;
  return { level: match[1].length, title };
}

function isDescriptionBoundary(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (headingFromLine(trimmed)) return true;
  if (isFenceLine(trimmed)) return true;
  if (/^([-*+]|\d+[.)])\s+/.test(trimmed)) return true;
  if (/^>/.test(trimmed)) return true;
  if (/^\|.+\|$/.test(trimmed)) return true;
  return false;
}

function findBestHeading(lines: string[]): HeadingHit | null {
  let best: HeadingHit | null = null;
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (isFenceLine(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = headingFromLine(line);
    if (!heading) continue;
    if (!best || heading.level < best.level) best = { level: heading.level, lineIndex: i, title: heading.title };
  }
  return best;
}

function parseMarkdownPlan(rawText: string): ParsedMarkdownPlan {
  const source = String(rawText ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!source) return { title: "计划", description: "", body: "（无）" };

  const lines = source.split("\n");
  const heading = findBestHeading(lines);
  if (!heading) return { title: "计划", description: "", body: source };

  let descriptionStart = -1;
  let descriptionEnd = -1;
  for (let i = heading.lineIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      if (descriptionStart >= 0) break;
      continue;
    }
    if (isDescriptionBoundary(line)) break;
    if (descriptionStart < 0) descriptionStart = i;
    descriptionEnd = i;
  }

  const description =
    descriptionStart >= 0 && descriptionEnd >= descriptionStart
      ? stripInlineMarkdown(lines.slice(descriptionStart, descriptionEnd + 1).join(" "))
      : "";

  const bodyLines = lines.filter((_, index) => {
    if (index === heading.lineIndex) return false;
    if (descriptionStart >= 0 && index >= descriptionStart && index <= descriptionEnd) return false;
    return true;
  });
  const body = bodyLines.join("\n").trim() || description || heading.title;

  return {
    title: heading.title || "计划",
    description,
    body,
  };
}

export default function MarkdownPlanOutputCard({
  rawText,
  markdown,
  text,
  forceCollapsed = false,
  headerActions,
  actions,
  className,
}: MarkdownPlanOutputCardProps) {
  const source = String(rawText ?? markdown ?? text ?? "");
  const parsed = useMemo(() => parseMarkdownPlan(source), [source]);
  const [expanded, setExpanded] = useState(!forceCollapsed);
  const bodyHtml = useMemo(() => renderMarkdownToSafeHtml(parsed.body, { cache: true }), [parsed.body]);

  useEffect(() => {
    setExpanded(!forceCollapsed);
  }, [source, forceCollapsed]);

  useEffect(() => {
    if (forceCollapsed) setExpanded(false);
  }, [forceCollapsed]);

  const toggleExpanded = () => setExpanded((value) => !value);

  return (
    <section
      className={[
        "markdown-plan-card chat-bubble-body min-w-0 overflow-hidden rounded-xl border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] shadow-[var(--chat-row-shadow)]",
        forceCollapsed ? "is-executing" : "",
        expanded ? "is-expanded" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="计划"
    >
      <header className="markdown-plan-card-head grid min-w-0 select-none grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3 border-b border-[color:var(--ui-well-border)] px-3 py-2.5 transition-[background,border-color] duration-150">
        <div
          className="markdown-plan-card-toggle grid min-w-0 gap-1"
          role="button"
          tabIndex={0}
          aria-expanded={expanded ? "true" : "false"}
          onClick={toggleExpanded}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            toggleExpanded();
          }}
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="markdown-plan-card-title m-0 min-w-0 text-[15px] leading-[1.25] font-semibold text-[var(--text)]">
              {parsed.title}
            </h2>
            {parsed.description ? (
              <p className="markdown-plan-card-description m-0 min-w-[180px] flex-1 text-[12px] leading-[1.4] text-[var(--text-muted)] [overflow-wrap:anywhere]">
                {parsed.description}
              </p>
            ) : null}
          </div>
          {forceCollapsed ? <div className="mono text-[11px] text-[var(--fg-warning)]">执行计划中</div> : null}
        </div>
        {headerActions && !expanded ? (
          <div className="markdown-plan-card-head-actions" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            {headerActions}
          </div>
        ) : null}
        <button className="markdown-plan-card-chevron-button" type="button" aria-expanded={expanded ? "true" : "false"} onClick={toggleExpanded}>
          <ChevronDown
            className={[
              "markdown-plan-card-chevron h-4 w-4 flex-none text-[var(--text-muted)] transition-[transform,color] duration-200 [stroke-width:2.2]",
              expanded ? "rotate-180 text-[var(--text)]" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-hidden="true"
          />
        </button>
      </header>

      <div className={["markdown-plan-card-body-shell", expanded ? "is-expanded" : "is-collapsed"].join(" ")}>
        <div className="markdown-plan-card-body grid min-w-0 gap-3 px-3 py-3">
          <AgentMarkdownContent className="agent-markdown-body min-w-0" html={bodyHtml} />
        </div>
      </div>

      {actions && expanded ? <div className="markdown-plan-card-actions border-t border-[var(--border)] px-3 py-2.5">{actions}</div> : null}
    </section>
  );
}
