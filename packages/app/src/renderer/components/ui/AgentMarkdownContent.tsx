import type { HTMLAttributes } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeMermaidError, readMermaidTone, renderMermaidDiagram } from "../../features/timeline/mermaidRenderer";
import {
  renderMarkdownToSafeHtml,
  whenMarkdownRendererReady,
} from "../../features/timeline/markdownRenderer";

export type AgentMarkdownContentProps = HTMLAttributes<HTMLDivElement> & {
  html?: string;
  markdown?: string;
  text?: string;
};

type CopyButtonState = "idle" | "success" | "error";

function readCodeLanguageLabel(codeElement: HTMLElement) {
  const languageClass = [...codeElement.classList].find((className) => className.startsWith("language-"));
  const raw = String(codeElement.getAttribute("data-language") || languageClass?.slice("language-".length) || "")
    .trim()
    .toUpperCase();
  return /^[A-Z0-9+#._-]{1,28}$/.test(raw) ? raw : "CODE";
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  try {
    textarea.focus();
    textarea.select();
    if (!document.execCommand("copy")) throw new Error("Copy failed");
  } finally {
    textarea.remove();
  }
}

function setCopyButtonState(button: HTMLButtonElement, state: CopyButtonState) {
  button.dataset.agentCodeCopyState = state;
  button.classList.toggle("is-success", state === "success");
  button.classList.toggle("is-error", state === "error");
  button.textContent = state === "success" ? "Copied" : state === "error" ? "Failed" : button.dataset.agentCopyIdleLabel || "Copy";
}

function enhanceCodeCopyButtons(host: HTMLElement) {
  host.querySelectorAll<HTMLElement>("pre > code").forEach((codeElement) => {
    if (codeElement.classList.contains("language-mermaid")) return;
    const preElement = codeElement.closest("pre");
    if (!(preElement instanceof HTMLElement)) return;
    preElement.classList.add("app-scrollbar");
    if (preElement.querySelector("[data-agent-code-role='toolbar']")) return;
    const toolbar = document.createElement("div");
    toolbar.className = "agent-code-toolbar";
    toolbar.dataset.agentCodeRole = "toolbar";
    const language = document.createElement("span");
    language.className = "agent-code-language";
    language.textContent = readCodeLanguageLabel(codeElement);
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "agent-code-copy";
    copyButton.dataset.agentCodeAction = "copy";
    copyButton.dataset.agentCopyIdleLabel = "Copy";
    copyButton.setAttribute("aria-label", "Copy code");
    setCopyButtonState(copyButton, "idle");
    toolbar.append(language, copyButton);
    preElement.append(toolbar);
  });
}

function createMermaidBlock(svg: string, source: string) {
  const block = document.createElement("div");
  block.className = "agent-mermaid-block";
  block.dataset.agentMermaidSource = source;
  const toolbar = document.createElement("div");
  toolbar.className = "agent-mermaid-toolbar";
  const status = document.createElement("span");
  status.className = "agent-mermaid-status";
  status.textContent = "Mermaid diagram";
  const actions = document.createElement("div");
  actions.className = "agent-mermaid-actions";
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "agent-mermaid-copy";
  copyButton.dataset.agentMermaidAction = "copy";
  copyButton.textContent = "Copy";
  actions.append(copyButton);
  toolbar.append(status, actions);
  const viewport = document.createElement("div");
  viewport.className = "agent-mermaid-viewport app-scrollbar";
  const render = document.createElement("div");
  render.className = "agent-mermaid-render";
  render.innerHTML = svg;
  viewport.append(render);
  block.append(toolbar, viewport);
  return block;
}

function createMermaidError(detail: string) {
  const error = document.createElement("div");
  error.className = "agent-mermaid-error";
  error.textContent = detail || "Mermaid render failed";
  return error;
}

export default function AgentMarkdownContent({
  html,
  markdown,
  text,
  className,
  onClick,
  ...props
}: AgentMarkdownContentProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [rendererTick, setRendererTick] = useState(0);
  const sourceHtml = useMemo(() => {
    if (html != null) return String(html ?? "");
    return renderMarkdownToSafeHtml(String(markdown ?? text ?? ""), { cache: true });
  }, [html, markdown, text, rendererTick]);

  useEffect(() => {
    if (html != null) return undefined;
    let cancelled = false;
    void whenMarkdownRendererReady()
      .then(() => {
        if (!cancelled) setRendererTick((value) => value + 1);
      })
      .catch((error) => console.warn("[markdown] renderer ready failed", error));
    return () => {
      cancelled = true;
    };
  }, [html, markdown, text]);

  useEffect(() => {
    const host = rootRef.current;
    if (!host) return undefined;
    let cancelled = false;
    enhanceCodeCopyButtons(host);

    const mermaidBlocks = [...host.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
    mermaidBlocks.forEach((codeElement, index) => {
      const preElement = codeElement.closest("pre");
      if (!(preElement instanceof HTMLElement)) return;
      const source = String(codeElement.textContent ?? "").trim();
      if (!source) return;
      preElement.replaceWith(createMermaidError("Rendering Mermaid diagram..."));
      void renderMermaidDiagram({
        id: `agent-mermaid-react-${Date.now()}-${index}`,
        source,
        tone: readMermaidTone(),
      })
        .then((svg) => {
          if (cancelled) return;
          host.querySelector(".agent-mermaid-error")?.replaceWith(createMermaidBlock(svg, source));
        })
        .catch((error) => {
          if (cancelled) return;
          const detail = normalizeMermaidError(error);
          host.querySelector(".agent-mermaid-error")?.replaceWith(createMermaidError(detail));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [sourceHtml]);

  return (
    <div
      {...props}
      ref={rootRef}
      className={["agent-markdown-body", className].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: sourceHtml }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const copyButton = target.closest("[data-agent-code-action='copy']");
        if (copyButton instanceof HTMLButtonElement) {
          event.preventDefault();
          const pre = copyButton.closest("pre");
          const code = pre?.querySelector("code");
          const source = String(code?.textContent ?? "");
          copyButton.disabled = true;
          void copyTextToClipboard(source)
            .then(() => setCopyButtonState(copyButton, "success"))
            .catch(() => setCopyButtonState(copyButton, "error"))
            .finally(() => {
              copyButton.disabled = false;
              window.setTimeout(() => {
                if (copyButton.isConnected) setCopyButtonState(copyButton, "idle");
              }, 1600);
            });
          return;
        }
        const mermaidCopyButton = target.closest("[data-agent-mermaid-action='copy']");
        if (mermaidCopyButton instanceof HTMLButtonElement) {
          event.preventDefault();
          const block = mermaidCopyButton.closest<HTMLElement>(".agent-mermaid-block");
          const source = String(block?.dataset.agentMermaidSource ?? "");
          mermaidCopyButton.disabled = true;
          void copyTextToClipboard(source)
            .then(() => {
              mermaidCopyButton.classList.add("is-success");
              mermaidCopyButton.textContent = "Copied";
            })
            .catch(() => {
              mermaidCopyButton.classList.add("is-error");
              mermaidCopyButton.textContent = "Failed";
            })
            .finally(() => {
              mermaidCopyButton.disabled = false;
              window.setTimeout(() => {
                if (!mermaidCopyButton.isConnected) return;
                mermaidCopyButton.classList.remove("is-success", "is-error");
                mermaidCopyButton.textContent = "Copy";
              }, 1600);
            });
        }
      }}
    />
  );
}
