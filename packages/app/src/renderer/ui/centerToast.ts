import type { ToastKind, ToastOptions } from "./toast";

let centerToastHost: HTMLDivElement | null = null;
const CENTER_TOAST_EXIT_ANIMATION_MS = 180;

function ensureCenterToastHost(): HTMLDivElement {
  if (centerToastHost && centerToastHost.isConnected) return centerToastHost;
  const host = document.createElement("div");
  host.className = "codex-center-toast-host";
  host.setAttribute("aria-live", "polite");
  host.setAttribute("aria-relevant", "additions");
  document.body.appendChild(host);
  centerToastHost = host;
  return host;
}

export function showCenterToast(options: ToastOptions): void {
  const host = ensureCenterToastHost();
  const message = String(options?.message ?? "").trim();
  if (!message) return;

  const kind: ToastKind = options?.kind ?? "info";
  const timeoutMs =
    typeof options?.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? Math.max(800, Math.min(15_000, Math.round(options.timeoutMs)))
      : 2400;

  const toast = document.createElement("div");
  toast.className = `codex-toast codex-center-toast ${kind}`;
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
    }, CENTER_TOAST_EXIT_ANIMATION_MS);
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
