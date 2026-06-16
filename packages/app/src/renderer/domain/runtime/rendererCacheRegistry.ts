import type {
  CacheClearArgs,
  CacheClearResult,
  CacheListResult,
  CacheStatsItem,
} from "@codenexus/shared/ipc/contracts";
import {
  invalidateThreadContentCache,
  normalizeCacheNamespace,
  pruneExpiredThreadContentCache,
  toRendererCacheItem,
  type RendererCacheProvider,
  type ThreadContentCacheEntry,
} from "./rendererCacheRuntime";

type ResourceCacheStore = {
  getResourceCacheStats: () => { items: number; bytes: number; updatedAt?: number };
  clearResourceCache: () => void;
};

type WorkspaceTreeCacheStore = {
  getTreeCacheStats: () => { items: number; bytes: number; updatedAt?: number };
  clearTreeCache: () => void;
};

export type RuntimeRendererCacheContext = {
  threadContentCacheByKey: Map<string, ThreadContentCacheEntry>;
  replayCacheByThread: Map<string, unknown[]>;
  replayWindowStateByThread: Map<string, unknown>;
  replayRequestSeqByThread: Map<string, unknown>;
  olderHistoryLoadPromiseByThread: Map<string, unknown>;
  skillsSnapshotByWorkspace: Map<string, unknown>;
  mcpSnapshotByWorkspace: Map<string, unknown>;
  mcpResourceStore: ResourceCacheStore;
  workspaceFilesStore: WorkspaceTreeCacheStore;
};

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "unknown error");
}

function estimateBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function buildRendererCacheProviders(context: RuntimeRendererCacheContext): Map<string, RendererCacheProvider> {
  const providers = new Map<string, RendererCacheProvider>();
  const register = (provider: RendererCacheProvider) => {
    const namespace = normalizeCacheNamespace(provider.namespace);
    if (!namespace) return;
    providers.set(namespace, {
      ...provider,
      namespace,
      clearable: provider.clearable !== false && typeof provider.clear === "function",
    });
  };

  register({
    namespace: "renderer.history.threadContent",
    getStats: () => {
      pruneExpiredThreadContentCache(context.threadContentCacheByKey);
      let bytes = 0;
      for (const [key, entry] of context.threadContentCacheByKey.entries()) {
        bytes += key.length;
        bytes += estimateBytes(entry.result);
      }
      return {
        items: context.threadContentCacheByKey.size,
        bytes,
        note: "threadContent 短 TTL 缓存",
      };
    },
    clear: () => {
      invalidateThreadContentCache(context.threadContentCacheByKey);
    },
  });

  register({
    namespace: "renderer.runtime.replay",
    getStats: () => {
      let items = 0;
      for (const entry of context.replayCacheByThread.values()) items += entry.length;
      return {
        items,
        bytes: estimateBytes([...context.replayCacheByThread.entries()]),
        note: "线程回放事件缓存",
      };
    },
    clear: () => {
      context.replayCacheByThread.clear();
      context.replayWindowStateByThread.clear();
      context.replayRequestSeqByThread.clear();
      context.olderHistoryLoadPromiseByThread.clear();
    },
  });

  register({
    namespace: "renderer.runtime.skillsSnapshot",
    getStats: () => ({
      items: context.skillsSnapshotByWorkspace.size,
      bytes: estimateBytes([...context.skillsSnapshotByWorkspace.entries()]),
      note: "右侧 skills 快照缓存",
    }),
    clear: () => {
      context.skillsSnapshotByWorkspace.clear();
    },
  });

  register({
    namespace: "renderer.runtime.mcpSnapshot",
    getStats: () => ({
      items: context.mcpSnapshotByWorkspace.size,
      bytes: estimateBytes([...context.mcpSnapshotByWorkspace.entries()]),
      note: "右侧 mcp 快照缓存",
    }),
    clear: () => {
      context.mcpSnapshotByWorkspace.clear();
    },
  });

  register({
    namespace: "renderer.mcp.resource",
    getStats: () => ({
      ...context.mcpResourceStore.getResourceCacheStats(),
      note: "MCP 资源读取缓存",
    }),
    clear: () => {
      context.mcpResourceStore.clearResourceCache();
    },
  });

  register({
    namespace: "renderer.workspace.tree",
    getStats: () => ({
      ...context.workspaceFilesStore.getTreeCacheStats(),
      note: "工作区目录树缓存",
    }),
    clear: () => {
      context.workspaceFilesStore.clearTreeCache();
    },
  });

  register({
    namespace: "renderer.timeline.markdown",
    getStats: async () => {
      const { getMarkdownHtmlCacheStats } = await import("../../features/timeline/markdownRenderer");
      return { ...getMarkdownHtmlCacheStats(), note: "Markdown HTML 缓存" };
    },
    clear: async () => {
      const { clearMarkdownHtmlCache } = await import("../../features/timeline/markdownRenderer");
      clearMarkdownHtmlCache();
    },
  });

  register({
    namespace: "renderer.timeline.diffParsed",
    getStats: async () => {
      const { getParsedDiffCacheStats } = await import("../../features/timeline/renderModel/diff");
      return { ...getParsedDiffCacheStats(), note: "Diff 解析缓存" };
    },
    clear: async () => {
      const { clearParsedDiffCache } = await import("../../features/timeline/renderModel/diff");
      clearParsedDiffCache();
    },
  });

  register({
    namespace: "renderer.timeline.diffHighlight",
    getStats: async () => {
      const { getDiffSyntaxHighlightCacheStats } =
        await import("../../features/timeline/renderModel/diffSyntaxHighlight");
      return { ...getDiffSyntaxHighlightCacheStats(), note: "Diff 高亮缓存" };
    },
    clear: async () => {
      const { clearDiffSyntaxHighlightCache } = await import("../../features/timeline/renderModel/diffSyntaxHighlight");
      clearDiffSyntaxHighlightCache();
    },
  });

  register({
    namespace: "renderer.media.localImage",
    getStats: async () => {
      const { getLocalImageCacheStats } = await import("../../features/media/localImageCache");
      return { ...getLocalImageCacheStats(), note: "本地图片 DataURL 缓存" };
    },
    clear: async () => {
      const { clearLocalImageCache } = await import("../../features/media/localImageCache");
      clearLocalImageCache();
    },
  });

  register({
    namespace: "renderer.media.notificationSound",
    getStats: async () => {
      const { getNotificationSoundCacheStats } = await import("../../features/notificationSound/player");
      return { ...getNotificationSoundCacheStats(), note: "提示音 DataURL 缓存" };
    },
    clear: async () => {
      const { clearNotificationSoundCache } = await import("../../features/notificationSound/player");
      clearNotificationSoundCache();
    },
  });

  register({
    namespace: "renderer.local.settingsMemory",
    getStats: async () => {
      const { getLocalSettingsMemoryCacheStats } = await import("../localSettings");
      return { ...getLocalSettingsMemoryCacheStats(), note: "本地设置内存镜像" };
    },
    clear: async () => {
      const { clearLocalSettingsMemoryCache } = await import("../localSettings");
      clearLocalSettingsMemoryCache();
    },
  });

  register({
    namespace: "renderer.local.draftMemory",
    getStats: async () => {
      const { getLocalDraftMemoryCacheStats } = await import("../localDraftState");
      return { ...getLocalDraftMemoryCacheStats(), note: "草稿内存镜像" };
    },
    clear: async () => {
      const { clearLocalDraftMemoryCache } = await import("../localDraftState");
      clearLocalDraftMemoryCache();
    },
  });

  register({
    namespace: "renderer.local.outboxMemory",
    getStats: async () => {
      const { getLocalMessageOutboxMemoryCacheStats } = await import("../localMessageOutbox");
      return { ...getLocalMessageOutboxMemoryCacheStats(), note: "消息出站内存镜像" };
    },
    clear: async () => {
      const { clearLocalMessageOutboxMemoryCache } = await import("../localMessageOutbox");
      clearLocalMessageOutboxMemoryCache();
    },
  });

  return providers;
}

export async function listRendererCachesForRuntime(context: RuntimeRendererCacheContext): Promise<CacheListResult> {
  const items: CacheStatsItem[] = [];
  for (const [namespace, provider] of buildRendererCacheProviders(context).entries()) {
    try {
      const stats = await provider.getStats();
      items.push(toRendererCacheItem(namespace, provider, stats));
    } catch (error) {
      items.push(
        toRendererCacheItem(namespace, provider, {
          items: 0,
          bytes: 0,
          updatedAt: Date.now(),
          note: `stats-error: ${readErrorMessage(error)}`,
        })
      );
    }
  }
  items.sort((a, b) => a.namespace.localeCompare(b.namespace, "en"));
  return {
    items,
    generatedAt: Date.now(),
  };
}

export async function clearRendererCachesForRuntime(
  context: RuntimeRendererCacheContext,
  args?: CacheClearArgs
): Promise<CacheClearResult> {
  const providers = buildRendererCacheProviders(context);
  const clearAll = Boolean(args?.clearAll);
  const requested = Array.isArray(args?.namespaces)
    ? args.namespaces.map((item) => normalizeCacheNamespace(item)).filter(Boolean)
    : [];
  const cleared: string[] = [];
  const skipped: CacheClearResult["skipped"] = [];
  const targets = clearAll ? [...providers.keys()] : requested;

  if (!clearAll && targets.length === 0) {
    const listed = await listRendererCachesForRuntime(context);
    return {
      ok: true,
      cleared: [],
      skipped: [{ namespace: "", reason: "no-namespaces" }],
      items: listed.items,
      generatedAt: listed.generatedAt,
    };
  }

  for (const namespace of targets) {
    const provider = providers.get(namespace);
    if (!provider) {
      skipped.push({ namespace, reason: "not-found" });
      continue;
    }
    if (provider.clearable === false || typeof provider.clear !== "function") {
      skipped.push({ namespace, reason: "not-clearable" });
      continue;
    }
    try {
      await provider.clear();
      cleared.push(namespace);
    } catch (error) {
      skipped.push({ namespace, reason: `clear-failed: ${readErrorMessage(error)}` });
    }
  }

  const listed = await listRendererCachesForRuntime(context);
  return {
    ok: true,
    cleared,
    skipped,
    items: listed.items,
    generatedAt: listed.generatedAt,
  };
}
