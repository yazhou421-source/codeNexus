import { codexDesktop } from "../../api/codexDesktopClient";

type CacheEntry = {
  dataUrl: string;
  lastAccessAt: number;
};

const MAX_CACHE_ENTRIES = 80;
const localImageCache = new Map<string, CacheEntry>();
const localImageInflight = new Map<string, Promise<string>>();

function pruneLocalImageCache() {
  if (localImageCache.size <= MAX_CACHE_ENTRIES) return;
  const entries = Array.from(localImageCache.entries());
  entries.sort((a, b) => a[1].lastAccessAt - b[1].lastAccessAt);
  const excess = Math.max(0, entries.length - MAX_CACHE_ENTRIES);
  for (let i = 0; i < excess; i += 1) {
    const key = entries[i]?.[0];
    if (key) localImageCache.delete(key);
  }
}

export async function readLocalImageDataUrl(path: string): Promise<string> {
  const key = String(path ?? "").trim();
  if (!key) return "";

  const cached = localImageCache.get(key);
  if (cached) {
    cached.lastAccessAt = Date.now();
    return cached.dataUrl;
  }

  const inflight = localImageInflight.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    const res = await codexDesktop.app.readImageFileDataUrl({ path: key });
    const dataUrl = String(res?.dataUrl ?? "").trim();
    if (!dataUrl) throw new Error("图片读取结果为空");
    localImageCache.set(key, { dataUrl, lastAccessAt: Date.now() });
    pruneLocalImageCache();
    return dataUrl;
  })();

  localImageInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    localImageInflight.delete(key);
  }
}

export function getLocalImageCacheStats(): { items: number; bytes: number; updatedAt: number } {
  let bytes = 0;
  for (const [key, entry] of localImageCache.entries()) {
    bytes += key.length;
    bytes += entry.dataUrl.length;
  }
  return {
    items: localImageCache.size,
    bytes: Math.max(0, Math.round(bytes)),
    updatedAt: Date.now(),
  };
}

export function clearLocalImageCache(): void {
  localImageCache.clear();
  localImageInflight.clear();
}
