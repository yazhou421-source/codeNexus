<template>
  <div class="lsb-pane-content">
    <div class="lsb-pane-head">
      <div class="lsb-pane-toolbar lsb-thread-toolbar">
        <button
          id="btn-add-thread"
          class="lsb-nav-row lsb-thread-create-btn"
          type="button"
          @click="runtime.createThread"
        >
          <SquarePen class="lsb-nav-icon" aria-hidden="true" />
          <span class="lsb-nav-text">{{ t("threadHistory.newThread") }}</span>
        </button>
        <button
          id="btn-refresh-history"
          class="lsb-icon-btn lsb-thread-refresh-btn"
          type="button"
          :aria-label="t('common.refresh')"
          :disabled="isRefreshingHistory"
          @click="onRefreshHistoryClick"
        >
          <span class="inline-flex" :class="{ spin: isRefreshingHistory }">
            <RefreshCw aria-hidden="true" />
          </span>
        </button>
      </div>
    </div>

    <label class="history-search"
      ><Search aria-hidden="true" /><input
        v-model="searchQuery"
        type="search"
        :aria-label="locale.startsWith('zh') ? '搜索对话' : 'Search conversations'"
        :placeholder="locale.startsWith('zh') ? '搜索对话…' : 'Search…'"
    /></label>
    <nav
      v-if="!runtimeStore.workspacePath"
      class="native-workspace-nav"
      :aria-label="locale.startsWith('zh') ? '工作区' : 'Workspace'"
    >
      <span>{{ locale.startsWith("zh") ? "工作区" : "Workspace" }}</span>
      <button
        type="button"
        :title="locale.startsWith('zh') ? '选择项目后浏览文件' : 'Open a project to browse files'"
        @click="runtime.selectWorkspace()"
      >
        <Folder />{{ locale.startsWith("zh") ? "文件" : "Files" }}
      </button>
      <button
        type="button"
        :title="locale.startsWith('zh') ? '选择项目后打开代码' : 'Open a project to edit code'"
        @click="runtime.selectWorkspace()"
      >
        <Code2 />{{ locale.startsWith("zh") ? "编辑器" : "Editor" }}
      </button>
      <button
        type="button"
        :title="locale.startsWith('zh') ? '选择项目后查看 Git 变更' : 'Open a project to review Git changes'"
        @click="runtime.selectWorkspace()"
      >
        <GitBranch />Git
      </button>
      <button type="button" @click="appShellStore.openSettings('integrations')"><Bot />Agents</button>
    </nav>
    <div class="lsb-pane-head-row history-section-heading">
      <div class="lsb-pane-title">{{ t("threadHistory.title") }}</div>
      <div class="lsb-head-badges">
        <span class="lsb-head-badge is-accent mono">{{ threadsCountText }}</span>
        <span v-if="runningThreadsCount > 0" class="lsb-head-badge is-success mono">
          {{ t("threadHistory.runningCount", { count: runningThreadsCount }) }}
        </span>
      </div>
    </div>

    <div v-if="searchQuery && !threadGroups.length" class="history-no-results">
      {{ locale.startsWith("zh") ? "没有匹配的对话" : "No matching conversations" }}
    </div>
    <div id="thread-history" class="lsb-scroll app-scrollbar">
      <div class="lsb-thread-groups" :class="{ dim: totalThreadListCount === 0 }">
        <template v-if="totalThreadListCount === 0">
          <div class="lsb-empty lsb-thread-empty mono">
            <div class="dim">{{ t("threadHistory.empty") }}</div>
            <button class="lsb-nav-row lsb-nav-row--workspace" type="button" @click="runtime.createThread">
              <span class="lsb-nav-text">{{ t("threadHistory.newThread") }}</span>
            </button>
          </div>
        </template>
        <template v-else>
          <section v-for="group in threadGroups" :key="group.key" class="lsb-section">
            <Collapsible
              class="lsb-section-collapsible"
              :open="isThreadGroupExpanded(group.key)"
              @update:open="(next) => onThreadGroupOpenChange(group.key, next)"
            >
              <template #trigger="{ open, triggerProps }">
                <div role="heading" aria-level="3">
                  <button class="lsb-group-head lsb-group-head-toggle" type="button" v-bind="triggerProps">
                    <span class="lsb-group-head-left">
                      <Folder class="lsb-group-icon" aria-hidden="true" />
                      <span class="lsb-group-title">{{ group.title }}</span>
                    </span>
                    <ChevronDown class="lsb-chevron" :class="{ open }" aria-hidden="true" />
                  </button>
                </div>
              </template>

              <div class="lsb-group-body">
                <ThreadRow
                  v-for="row in group.rows"
                  :key="`row:${row.item.id}`"
                  :row="row"
                  :active-thread-id="runtimeStore.currentThreadId"
                  :is-invalid-workspace-item="isInvalidWorkspaceItem"
                  :is-pending-thread-id="isPendingThreadId"
                  :should-show-user-input-badge="shouldShowUserInputBadge"
                  :should-show-thread-attention="shouldShowThreadAttention"
                  :running-thread-ids="threadStore.runningThreadIds"
                  :recently-completed-thread-ids="threadStore.recentlyCompletedThreadIds"
                  :thread-aria-label="threadAriaLabel"
                  :thread-row-depth-style="threadRowDepthStyle"
                  :format-relative-time="formatRelativeTime"
                  @open-thread="onThreadItemClick"
                  @clear-thread-attention="onClearThreadAttention"
                  @rename-thread="onRenameThread"
                  @delete-thread="runtime.deleteHistoryThread"
                />
              </div>
            </Collapsible>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Bot, ChevronDown, Code2, Folder, GitBranch, RefreshCw, Search, SquarePen } from "lucide-vue-next";
import type { LocalThreadItem, ThreadHistoryItem } from "../../../domain/types";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useThreadStore } from "../../../stores/thread.store";
import { useUserInputStore } from "../../../stores/userInput.store";
import { normalizeThreadTitleOverride } from "../../../features/history/threadTitle";
import { isPendingThreadId } from "../../../shared/threadCreateDebug";
import Collapsible from "../../ui/Collapsible.vue";
import ThreadRow from "./ThreadRow.vue";
import { showToast } from "../../../ui/toast";

type ThreadListItem = Pick<
  ThreadHistoryItem,
  | "id"
  | "title"
  | "meta"
  | "updatedAt"
  | "cwd"
  | "forkedFromId"
  | "agentNickname"
  | "agentRole"
  | "agentPath"
  | "gitInfoSummary"
> & {
  localStatus?: LocalThreadItem["status"];
};
type ThreadRowModel = {
  item: ThreadListItem;
  depth: number;
};
type ThreadGroup = { key: string; title: string; cwdFull: string; updatedAt: number; rows: ThreadRowModel[] };

const runtime = getRuntimeOrchestrator();
const appShellStore = useAppShellStore();
const runtimeStore = useRuntimeStore();
const threadStore = useThreadStore();
const userInputStore = useUserInputStore();
const { t, locale } = useI18n();
const searchQuery = ref("");

const isRefreshingHistory = ref(false);
const nowMs = ref(Date.now());
let intervalId: number | null = null;

const onRefreshHistoryClick = async () => {
  if (isRefreshingHistory.value) return;
  isRefreshingHistory.value = true;
  try {
    await runtime.refreshHistory(true);
  } finally {
    isRefreshingHistory.value = false;
  }
};

function normalizeFsPath(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let s = raw.replace(/\//g, "\\");
  while (s.endsWith("\\") && s.length > 3) s = s.slice(0, -1);
  return s.toLowerCase();
}

function normalizeThreadId(value: unknown): string {
  return String(value ?? "").trim();
}

function toBasename(pathValue: string): string {
  const normalized = String(pathValue ?? "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "");
  if (!normalized) return "";
  const parts = normalized.split("\\").filter(Boolean);
  return parts.length > 0 ? String(parts[parts.length - 1] ?? "").trim() : normalized;
}

const workspaceTitleCollator =
  typeof Intl !== "undefined" && typeof Intl.Collator === "function"
    ? new Intl.Collator(["zh-Hans-u-co-pinyin", "zh-CN-u-co-pinyin", "zh-CN", "en"], {
        usage: "sort",
        sensitivity: "base",
        numeric: true,
        ignorePunctuation: true,
      })
    : null;
const compareWorkspaceTitle = (a: string, b: string) =>
  workspaceTitleCollator
    ? workspaceTitleCollator.compare(String(a ?? "").trim(), String(b ?? "").trim())
    : String(a ?? "")
        .trim()
        .localeCompare(String(b ?? "").trim(), "zh-CN", { sensitivity: "base", numeric: true });
const sortByUpdatedAtDesc = (a: ThreadListItem, b: ThreadListItem) =>
  a.updatedAt !== b.updatedAt ? b.updatedAt - a.updatedAt : a.title.localeCompare(b.title);

const visibleThreadItems = computed<ThreadListItem[]>(() => {
  const map = new Map<string, ThreadListItem>();
  for (const item of threadStore.threadHistory) {
    const id = normalizeThreadId(item.id);
    if (id) map.set(id, item);
  }
  for (const item of threadStore.localThreads) {
    const id = normalizeThreadId(item.id);
    if (!id || map.has(id)) continue;
    map.set(id, {
      id,
      title: String(item.title ?? ""),
      meta: String(item.meta ?? ""),
      updatedAt: Number(item.updatedAt ?? item.createdAt ?? Date.now()),
      cwd: item.cwd,
      forkedFromId: item.forkedFromId,
      agentNickname: item.agentNickname,
      agentRole: item.agentRole,
      agentPath: item.agentPath,
      gitInfoSummary: item.gitInfoSummary,
      localStatus: item.status,
    });
  }
  return [...map.values()].sort(sortByUpdatedAtDesc);
});

const threadHistoryById = computed(() => {
  const map = new Map<string, ThreadListItem>();
  for (const item of visibleThreadItems.value) {
    const id = normalizeThreadId(item.id);
    if (id) map.set(id, item);
  }
  return map;
});

const threadGroups = computed<ThreadGroup[]>(() => {
  const groups = new Map<
    string,
    { key: string; title: string; cwdFull: string; updatedAt: number; items: ThreadListItem[] }
  >();
  for (const sourceItem of visibleThreadItems.value) {
    const query = searchQuery.value.trim().toLowerCase();
    if (
      query &&
      !`${threadStore.displayThreadTitle(sourceItem.id, sourceItem.title)} ${sourceItem.cwd || ""}`
        .toLowerCase()
        .includes(query)
    )
      continue;
    const item: ThreadListItem = {
      id: String(sourceItem.id ?? ""),
      title: threadStore.displayThreadTitle(sourceItem.id, sourceItem.title),
      meta: String(sourceItem.meta ?? ""),
      updatedAt: Number(sourceItem.updatedAt ?? 0),
      cwd: sourceItem.cwd,
      forkedFromId: sourceItem.forkedFromId,
      agentNickname: sourceItem.agentNickname,
      agentRole: sourceItem.agentRole,
      agentPath: sourceItem.agentPath,
      gitInfoSummary: sourceItem.gitInfoSummary,
      localStatus: sourceItem.localStatus,
    };
    const cwd = String(item.cwd ?? "").trim();
    const key = cwd ? normalizeFsPath(cwd) : "__no_workspace__";
    const title = cwd ? toBasename(cwd) : t("threadHistory.noWorkspace");
    const existing = groups.get(key);
    if (existing) {
      existing.updatedAt = Math.max(existing.updatedAt, item.updatedAt);
      existing.items.push(item);
      continue;
    }
    groups.set(key, { key, title, cwdFull: cwd, updatedAt: item.updatedAt, items: [item] });
  }
  const out: ThreadGroup[] = [];
  for (const group of groups.values()) {
    const items = [...group.items].sort(sortByUpdatedAtDesc);
    const rows: ThreadRowModel[] = items.map((item) => ({ item, depth: 0 }));
    out.push({ key: group.key, title: group.title, cwdFull: group.cwdFull, updatedAt: group.updatedAt, rows });
  }
  out.sort((a, b) => {
    if (a.key === "__no_workspace__" && b.key !== "__no_workspace__") return 1;
    if (b.key === "__no_workspace__" && a.key !== "__no_workspace__") return -1;
    const byTitle = compareWorkspaceTitle(a.title, b.title);
    return byTitle !== 0 ? byTitle : compareWorkspaceTitle(a.cwdFull || a.key, b.cwdFull || b.key);
  });
  return out;
});

const runningThreadsCount = computed(() => threadStore.runningThreadIds.size);
const totalThreadListCount = computed(() => visibleThreadItems.value.length);
const threadsCountText = computed(() => t("threadHistory.totalCount", { count: totalThreadListCount.value }));
const visibleThreadGroupKeys = computed(() => {
  return new Set(threadGroups.value.map((group) => String(group.key ?? "").trim()).filter(Boolean));
});

const currentThreadGroupKey = computed(() => {
  const currentId = normalizeThreadId(runtimeStore.currentThreadId);
  if (!currentId) return "";

  const currentThread = threadHistoryById.value.get(currentId);
  if (currentThread) {
    const cwd = String(currentThread.cwd ?? "").trim();
    return cwd ? normalizeFsPath(cwd) : "__no_workspace__";
  }

  const fallbackWorkspace = String(threadStore.currentWorkspace ?? runtimeStore.workspacePath ?? "").trim();
  return fallbackWorkspace ? normalizeFsPath(fallbackWorkspace) : "__no_workspace__";
});

watch(
  [currentThreadGroupKey, visibleThreadGroupKeys],
  ([groupKey, visibleKeys]) => {
    if (!groupKey || !visibleKeys.has(groupKey)) return;
    appShellStore.ensureThreadWorkspaceGroupExpanded(groupKey);
  },
  { immediate: true }
);

const isThreadGroupExpanded = (groupKeyValue: string) => !appShellStore.isThreadWorkspaceGroupCollapsed(groupKeyValue);
const onThreadGroupOpenChange = (groupKeyValue: string, open: boolean) =>
  appShellStore.setThreadWorkspaceGroupCollapsed(groupKeyValue, !open);
function extractInvalidWorkspacePathFromError(errorText: string): string {
  const text = String(errorText ?? "");
  for (const re of [
    /Workspace directory does not exist:\s*([^\r\n.]+)(?:\.|$)/i,
    /Workspace path is not a directory:\s*([^\r\n.]+)(?:\.|$)/i,
    /Workspace directory is not accessible:\s*([^\r\n(]+)(?:\(|\.|$)/i,
  ]) {
    const candidate = String(text.match(re)?.[1] ?? "").trim();
    if (candidate) return candidate;
  }
  return "";
}
const invalidWorkspacePath = computed(() =>
  appShellStore.serverConnState !== "failed" ? "" : extractInvalidWorkspacePathFromError(appShellStore.serverError)
);
const isInvalidWorkspaceItem = (item: { cwd?: string }) => {
  const bad = normalizeFsPath(invalidWorkspacePath.value);
  const cwd = normalizeFsPath(String(item?.cwd ?? ""));
  return Boolean(bad && cwd && cwd === bad);
};
const shouldShowUserInputBadge = (threadIdValue: string) =>
  userInputStore.queueSizeForThread(String(threadIdValue ?? "").trim()) > 0;
const threadAriaLabel = (row: ThreadRowModel) => {
  const title = threadStore.displayThreadTitle(row.item.id, row.item.title);
  const git = String(row.item.gitInfoSummary ?? "").trim();
  return git
    ? `${t("threadHistory.openThreadAria", { title })} · ${git}`
    : t("threadHistory.openThreadAria", { title });
};
const shouldShowThreadAttention = (threadId: string) => {
  const tid = String(threadId ?? "").trim();
  return Boolean(tid && tid !== runtimeStore.currentThreadId && threadStore.attentionThreadIds.has(tid));
};
const onClearThreadAttention = (threadId: string) => threadStore.clearThreadAttention(threadId);
const onRenameThread = async (threadIdValue: string, titleValue: string) => {
  const threadId = normalizeThreadId(threadIdValue);
  if (!threadId) return;

  const normalized = normalizeThreadTitleOverride(titleValue);
  const previous = threadStore.threadTitleOverridesByThreadId.get(threadId) ?? "";

  if (normalized) threadStore.setThreadTitleOverride(threadId, normalized);
  else threadStore.clearThreadTitleOverride(threadId);

  try {
    if (normalized) {
      await codexDesktop.history.setThreadTitleOverride({ threadId, title: normalized });
    } else {
      await codexDesktop.history.clearThreadTitleOverride({ threadId });
    }
  } catch (error) {
    if (previous) threadStore.setThreadTitleOverride(threadId, previous);
    else threadStore.clearThreadTitleOverride(threadId);
    showToast({
      kind: "error",
      title: t("threadHistory.renameFailed"),
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
const threadRowDepthStyle = (depth: number) =>
  ({ "--lsb-thread-depth": String(Math.max(0, Math.round(depth))) }) as Record<string, string>;
const onThreadItemClick = (threadId: string) => {
  const tid = String(threadId ?? "").trim();
  if (!tid) return;
  threadStore.clearThreadAttention(tid);
  if (tid === runtimeStore.currentThreadId) return;
  runtime.switchThread(tid);
};

onMounted(() => {
  intervalId = window.setInterval(() => {
    nowMs.value = Date.now();
  }, 30_000);
});
onBeforeUnmount(() => {
  if (intervalId != null) window.clearInterval(intervalId);
});

function formatRelativeTime(updatedAt: number): string {
  const ts = Number(updatedAt);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const deltaSec = Math.floor(Math.max(0, nowMs.value - ts) / 1000);
  if (deltaSec < 90) return "Now";
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m`;
  const deltaH = Math.floor(deltaMin / 60);
  if (deltaH < 24) return `${deltaH}h`;
  return `${Math.floor(deltaH / 24)}d`;
}
</script>
