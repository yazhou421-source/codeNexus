export type MermaidTone = "light" | "dark";

type MermaidModule = typeof import("mermaid");
type DomPurify = typeof import("dompurify").default;

let mermaidModulePromise: Promise<MermaidModule["default"]> | null = null;
let domPurifyPromise: Promise<DomPurify> | null = null;
let mermaidRenderQueue: Promise<void> = Promise.resolve();
let mermaidInitializedTone: MermaidTone | null = null;

function loadMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid").then((mod) => mod.default);
  }
  return mermaidModulePromise;
}

function loadDOMPurify() {
  if (!domPurifyPromise) {
    domPurifyPromise = import("dompurify").then((mod) => mod.default);
  }
  return domPurifyPromise;
}

export async function sanitizeDiagramSvg(svg: string) {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") return svg;

  const parser = new DOMParser();
  const svgDocument = parser.parseFromString(svg, "image/svg+xml");
  // Never inject unsanitized SVG when parsing fails.
  if (svgDocument.querySelector("parsererror")) {
    throw new Error("SVG 解析失败");
  }

  svgDocument.querySelectorAll("script, iframe, object, embed").forEach((element) => element.remove());

  svgDocument.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = String(attr.value ?? "");
      if (name.startsWith("on")) {
        element.removeAttribute(attr.name);
        return;
      }
      if ((name === "href" || name === "xlink:href") && /^\s*(javascript:|data:text\/html)/i.test(value)) {
        element.removeAttribute(attr.name);
      }
    });
  });

  const foreignObjects = [...svgDocument.querySelectorAll("foreignObject")];
  if (foreignObjects.length > 0) {
    const DOMPurify = await loadDOMPurify();
    foreignObjects.forEach((element) => {
      const sanitizedHtml = String(
        DOMPurify.sanitize(element.innerHTML, {
          USE_PROFILES: { html: true },
          FORBID_TAGS: [
            "style",
            "script",
            "iframe",
            "object",
            "embed",
            "form",
            "input",
            "button",
            "textarea",
            "select",
          ],
          FORBID_ATTR: [
            "onerror",
            "onload",
            "onclick",
            "onmouseover",
            "onfocus",
            "onmouseenter",
            "onmouseleave",
            "style",
            "formaction",
            "xlink:href",
          ],
          ALLOW_DATA_ATTR: false,
        })
      );
      element.innerHTML = sanitizedHtml;
    });
  }

  return new XMLSerializer().serializeToString(svgDocument.documentElement);
}

function mermaidTheme(tone: MermaidTone) {
  return tone === "light" ? "default" : "dark";
}

export function readMermaidTone(): MermaidTone {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-tone") === "light" ? "light" : "dark";
}

export function normalizeMermaidError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return "Mermaid 渲染失败，已回退为代码块。";
  return normalized.slice(0, 220);
}

export async function renderMermaidDiagram(args: { id: string; source: string; tone: MermaidTone }): Promise<string> {
  const { id, source, tone } = args;

  const task = mermaidRenderQueue.then(async () => {
    const mermaid = await loadMermaid();
    if (mermaidInitializedTone !== tone) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        theme: mermaidTheme(tone),
        fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
        flowchart: {
          htmlLabels: false,
          useMaxWidth: true,
        },
        sequence: {
          useMaxWidth: true,
        },
        gantt: {
          useMaxWidth: true,
        },
      });
      mermaidInitializedTone = tone;
    }
    const result = await mermaid.render(id, source);
    const sanitized = await sanitizeDiagramSvg(result.svg);
    if (!sanitized.trim()) {
      throw new Error("Mermaid SVG 为空");
    }
    return sanitized;
  });

  mermaidRenderQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}
