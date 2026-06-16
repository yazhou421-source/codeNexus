// 轻量 Toast 提示：用于在页面右上角展示短时反馈信息。
export type ToastKind = "info" | "success" | "warn" | "error";

export type ToastOptions = {
  title?: string;
  message: string;
  kind?: ToastKind;
  timeoutMs?: number;
};

let toastHost: HTMLDivElement | null = null;
const TOAST_EXIT_ANIMATION_MS = 180;

// 延迟创建 toast 容器，避免启动阶段额外 DOM 噪音。
function ensureToastHost(): HTMLDivElement {
  if (toastHost && toastHost.isConnected) return toastHost;
  const host = document.createElement("div");
  host.className = "codex-toast-host";
  host.setAttribute("aria-live", "polite");
  host.setAttribute("aria-relevant", "additions");
  document.body.appendChild(host);
  toastHost = host;
  return host;
}

// 展示 toast 并自动回收；hover 时暂停自动关闭计时。
export function showToast(options: ToastOptions): void {
  const host = ensureToastHost();
  const message = String(options?.message ?? "").trim();
  if (!message) return;

  const kind: ToastKind = options?.kind ?? "info";
  const timeoutMs =
    typeof options?.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? Math.max(800, Math.min(15_000, Math.round(options.timeoutMs)))
      : 2600;

  const toast = document.createElement("div");
  toast.className = `codex-toast ${kind}`;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");

  if (options?.title) {
    const title = document.createElement("div");
    title.className = "codex-toast-title";
    title.textContent = String(options.title);
    toast.appendChild(title);
  }

  const body = document.createElement("div");
  body.className = "codex-toast-message";
  body.textContent = message;
  toast.appendChild(body);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "codex-toast-close";
  close.setAttribute("aria-label", "关闭提示");
  close.textContent = "×";
  toast.appendChild(close);

  let timer: number | null = null;
  const cleanup = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
    try {
      toast.classList.add("closing");
    } catch {}
    window.setTimeout(() => {
      try {
        toast.remove();
      } catch {}
    }, TOAST_EXIT_ANIMATION_MS);
  };

  close.onclick = (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    cleanup();
  };

  toast.onmouseenter = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  toast.onmouseleave = () => {
    if (!timer) timer = window.setTimeout(cleanup, timeoutMs);
  };

  host.appendChild(toast);
  timer = window.setTimeout(cleanup, timeoutMs);
}
