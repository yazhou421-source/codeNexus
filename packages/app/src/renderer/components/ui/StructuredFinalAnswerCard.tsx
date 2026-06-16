import { useEffect, useMemo, useState } from "react";
import {
  structuredFinalAnswerToMarkdownV1,
  tryParseStructuredFinalAnswerV1,
  type StructuredFinalAnswerV1,
} from "../../domain/structuredFinalAnswer";
import { renderMarkdownToSafeHtml } from "../../features/timeline/markdownRenderer";
import { showToast } from "../../ui/toast";
import AgentMarkdownContent from "./AgentMarkdownContent";

type CopyState = "idle" | "success" | "error";

type StructuredFinalAnswerCardProps = {
  rawText?: string;
  text?: string;
  content?: string;
  className?: string;
};

const COPY_FEEDBACK_RESET_MS = 1200;

function fallbackAnswer(): StructuredFinalAnswerV1 {
  return {
    type: "codenexus.final_answer.v1",
    summary: "",
    changes: [],
    commands: [],
    next_steps: [],
  };
}

function toMarkdownList(items: string[]): string {
  const normalized = (Array.isArray(items) ? items : []).map((item) => String(item ?? "").trim()).filter(Boolean);
  if (normalized.length === 0) return `- （无）`;
  return normalized.map((item) => `- ${item}`).join("\n");
}

async function copyTextToClipboard(text: string) {
  const source = String(text ?? "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(source);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = source;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  try {
    textarea.focus();
    textarea.select();
    if (!document.execCommand("copy")) throw new Error("复制失败");
  } finally {
    textarea.remove();
  }
}

function copyButtonLabel(state: CopyState, idle: string): string {
  if (state === "success") return "已复制";
  if (state === "error") return "复制失败";
  return idle;
}

export default function StructuredFinalAnswerCard({ rawText, text, content, className }: StructuredFinalAnswerCardProps) {
  const source = String(rawText ?? content ?? text ?? "");
  const answer = useMemo(() => tryParseStructuredFinalAnswerV1(source) ?? fallbackAnswer(), [source]);
  const commands = useMemo(
    () => (Array.isArray(answer.commands) ? answer.commands : []).map((item) => String(item ?? "").trim()).filter(Boolean),
    [answer.commands]
  );
  const summaryHtml = useMemo(
    () => renderMarkdownToSafeHtml(String(answer.summary ?? "").trim() || "（无）", { cache: true }),
    [answer.summary]
  );
  const changesHtml = useMemo(() => renderMarkdownToSafeHtml(toMarkdownList(answer.changes), { cache: true }), [answer.changes]);
  const nextStepsHtml = useMemo(
    () => renderMarkdownToSafeHtml(toMarkdownList(answer.next_steps), { cache: true }),
    [answer.next_steps]
  );
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyMarkdownState, setCopyMarkdownState] = useState<CopyState>("idle");
  const [copyCommandsState, setCopyCommandsState] = useState<CopyState>("idle");
  const [copyJsonState, setCopyJsonState] = useState<CopyState>("idle");

  useEffect(() => {
    if (copyMarkdownState === "idle" && copyCommandsState === "idle" && copyJsonState === "idle") return undefined;
    const timer = window.setTimeout(() => {
      setCopyMarkdownState("idle");
      setCopyCommandsState("idle");
      setCopyJsonState("idle");
    }, COPY_FEEDBACK_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [copyMarkdownState, copyCommandsState, copyJsonState]);

  const withCopyFeedback = async (setState: (state: CopyState) => void, value: string, okToast?: string) => {
    if (copyBusy) return;
    setCopyBusy(true);
    try {
      await copyTextToClipboard(value);
      setState("success");
      if (okToast) showToast({ kind: "success", title: "已复制", message: okToast });
    } catch (error: any) {
      setState("error");
      showToast({ kind: "error", title: "复制失败", message: String(error?.message ?? error ?? "") });
    } finally {
      setCopyBusy(false);
    }
  };

  return (
    <section
      className={[
        "structured-final-answer-card grid min-w-0 gap-3 rounded-xl border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] p-3",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="结构化最终答复"
    >
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold tracking-[0.2px] text-[color:var(--text)]">
            结构化答复
          </div>
          <div className="dim text-[11px] leading-[1.35]">总结 / 变更 / 命令 / 下一步</div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <button className="btn-mini" type="button" disabled={copyBusy} onClick={() => withCopyFeedback(setCopyMarkdownState, structuredFinalAnswerToMarkdownV1(answer))}>
            {copyButtonLabel(copyMarkdownState, "复制 Markdown")}
          </button>
          <button className="btn-mini" type="button" disabled={copyBusy} onClick={() => withCopyFeedback(setCopyCommandsState, commands.join("\n"), "命令已复制到剪贴板")}>
            {copyButtonLabel(copyCommandsState, "复制命令")}
          </button>
          <button className="btn-mini" type="button" disabled={copyBusy} onClick={() => withCopyFeedback(setCopyJsonState, JSON.stringify(answer, null, 2))}>
            {copyButtonLabel(copyJsonState, "复制 JSON")}
          </button>
        </div>
      </header>

      <div className="grid min-w-0 gap-3">
        <div className="grid min-w-0 gap-1.5">
          <div className="mono dim text-[11px]">总结</div>
          <AgentMarkdownContent className="agent-markdown-body min-w-0" html={summaryHtml} />
        </div>

        <div className="grid min-w-0 gap-1.5">
          <div className="mono dim text-[11px]">变更</div>
          <AgentMarkdownContent className="agent-markdown-body min-w-0" html={changesHtml} />
        </div>

        <div className="grid min-w-0 gap-1.5">
          <div className="mono dim text-[11px]">命令</div>
          {commands.length === 0 ? (
            <div className="dim text-[12px]">（无）</div>
          ) : (
            <div className="grid min-w-0 gap-2">
              {commands.map((cmd, idx) => (
                <div
                  key={`cmd:${idx}:${cmd}`}
                  className="row min-w-0 items-start gap-2 rounded-lg border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] px-2 py-1.5"
                >
                  <code className="mono min-w-0 flex-1 text-[11px] leading-[1.45] text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words">
                    {cmd}
                  </code>
                  <button
                    className="btn-mini flex-none"
                    type="button"
                    disabled={copyBusy}
                    onClick={() => withCopyFeedback(() => undefined, cmd, "命令已复制到剪贴板")}
                  >
                    {"复制"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid min-w-0 gap-1.5">
          <div className="mono dim text-[11px]">下一步</div>
          <AgentMarkdownContent className="agent-markdown-body min-w-0" html={nextStepsHtml} />
        </div>
      </div>
    </section>
  );
}
