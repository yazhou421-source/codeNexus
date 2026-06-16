import { codexDesktop } from "../../api/codexDesktopClient";

export type ExternalUrlRuntime = {
  openExternalUrl: (url: string) => Promise<void>;
};

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function normalizeExternalUrlForOpen(url: string): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const protocol = String(parsed.protocol ?? "").toLowerCase();
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(protocol)) return "";
    if ((protocol === "http:" || protocol === "https:") && !parsed.hostname) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function createExternalUrlRuntime(): ExternalUrlRuntime {
  const openExternalUrl = async (url: string) => {
    const value = normalizeExternalUrlForOpen(url);
    if (!value) throw new Error("仅支持 http/https/mailto 外链。");
    await codexDesktop.app.openExternal({ url: value });
  };

  return { openExternalUrl };
}
