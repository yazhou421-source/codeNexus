<template>
  <aside class="sidebar sidebar-right debug-timeline-sidebar">
    <header class="debug-timeline-sidebar-head">
      <div class="debug-timeline-sidebar-title">
        <span class="mono">{{ t("debugTimeline.title") }}</span>
        <span class="mono dim">{{ t("debugTimeline.subtitle") }}</span>
      </div>
      <div class="debug-timeline-sidebar-actions">
        <span class="mono dim text-[10px]">Ctrl/⌘ + Alt + J</span>
        <button class="btn-mini" type="button" @click="close">{{ t("common.close") }}</button>
      </div>
    </header>
    <div class="debug-timeline-sidebar-body app-scrollbar" role="region" :aria-label="t('debugTimeline.regionAria')">
      <TimelinePane :contentEvents="debugOverlayEvents" :workspaceRoot="workspaceRoot" />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import TimelinePane from "../chat/TimelinePane.vue";
import type { TimelineEventItem } from "../../../domain/types";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useCustomChatStore } from "../../../stores/customChat.store";
import { useDebugTimelineStore } from "../../../stores/debugTimeline.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useTimelineStore } from "../../../stores/timeline.store";

const appShellStore = useAppShellStore();
const customChatStore = useCustomChatStore();
const runtimeStore = useRuntimeStore();
const timelineStore = useTimelineStore();
const debugTimelineStore = useDebugTimelineStore();
const { t } = useI18n();

const isCustomMode = computed(() => appShellStore.runtimeMode === "custom");
const timelineKey = computed(() =>
  isCustomMode.value ? customChatStore.debugThreadId() : String(runtimeStore.timelineKey ?? "__app__")
);
const workspaceRoot = computed(() =>
  isCustomMode.value ? customChatStore.currentWorkspaceRootForDebug() : String(runtimeStore.workspacePath ?? "").trim()
);
const contentTimelineEvents = computed<TimelineEventItem[]>(() =>
  isCustomMode.value ? [] : timelineStore.eventsForThread(timelineKey.value)
);
const debugTimelineEvents = computed<TimelineEventItem[]>(() => debugTimelineStore.eventsForThread(timelineKey.value));
const debugOverlayEvents = computed<TimelineEventItem[]>(() => {
  const combined = [...contentTimelineEvents.value, ...debugTimelineEvents.value];
  combined.sort((a, b) => {
    const ta = Number.isFinite(a.createdAt) ? a.createdAt : 0;
    const tb = Number.isFinite(b.createdAt) ? b.createdAt : 0;
    if (ta !== tb) return ta - tb;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
  return combined;
});

function close() {
  runtimeStore.setTimelineDebugEnabled(false);
}

onMounted(() => {
  debugTimelineStore.loadThread(timelineKey.value);
});

watch(
  timelineKey,
  (threadId) => {
    debugTimelineStore.loadThread(threadId);
  },
  { flush: "post" }
);
</script>

<style scoped>
.debug-timeline-sidebar {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface-1) 90%, transparent),
      color-mix(in srgb, var(--bg) 94%, transparent)
    ),
    var(--surface-1);
}

.debug-timeline-sidebar-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.debug-timeline-sidebar-title,
.debug-timeline-sidebar-actions {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.debug-timeline-sidebar-title {
  flex: 1 1 auto;
  overflow: hidden;
}

.debug-timeline-sidebar-actions {
  flex: 0 0 auto;
}

.debug-timeline-sidebar-body {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px;
}
</style>
