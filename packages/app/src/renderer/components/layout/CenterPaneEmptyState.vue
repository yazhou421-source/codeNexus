<template>
  <div class="center-empty-state">
    <div v-if="loading" class="mono dim flex w-full items-center justify-center gap-3 my-12">
      <span class="running-indicator is-muted" aria-hidden="true"></span>
      <span class="text-sm">{{ t("centerEmpty.loadingMemory") }}</span>
    </div>

    <template v-else>
      <div v-if="mode === 'pendingThread'" class="center-thread-create-state" role="status" aria-live="polite">
        <span class="running-indicator is-accent center-thread-create-state__spinner" aria-hidden="true"></span>
        <div class="center-thread-create-state__copy">
          <LoadingDots
            class="center-thread-create-state__title"
            :baseText="t('centerEmpty.creatingThread')"
            :intervalMs="360"
            :maxDots="3"
            as="div"
            :ariaLabel="t('centerEmpty.creatingThread')"
          />
          <div class="center-thread-create-state__meta">{{ t("centerEmpty.initializingContext") }}</div>
        </div>
      </div>

      <div v-else class="new-task-heading">
        <BrandLogo kind="symbol" />
        <h1>{{ t("threadHistory.newThread") }}</h1>
        <TopBarWorkspaceButton />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ThreadHistoryItem } from "../../domain/types";
import LoadingDots from "../ui/LoadingDots.vue";
import BrandLogo from "../brand/BrandLogo.vue";
import TopBarWorkspaceButton from "./topbar/TopBarWorkspaceButton.vue";
import { useI18n } from "vue-i18n";

defineProps<{
  loading: boolean;
  historyItems: ThreadHistoryItem[];
  mode: "default" | "pendingThread";
}>();

defineEmits<{
  (event: "switch-thread", threadId: string): void;
}>();

const { t } = useI18n();
</script>

<style scoped>
.center-thread-create-state {
  width: min(100%, 360px);
  min-height: 64px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  margin: 10vh auto 0;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--border) 82%, var(--accent) 18%);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-2) 88%, transparent);
  box-shadow: 0 10px 30px color-mix(in srgb, var(--theme-seed-shadow-source) 14%, transparent);
  animation: center-thread-create-enter 160ms ease-out both;
}

.center-thread-create-state__spinner {
  width: 16px;
  height: 16px;
  border-width: 2px;
}

.center-thread-create-state__copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.center-thread-create-state__title {
  min-width: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  white-space: nowrap;
}

.center-thread-create-state__meta {
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes center-thread-create-enter {
  from {
    opacity: 0;
    transform: translate3d(0, 4px, 0);
  }

  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .center-thread-create-state {
    animation: none;
  }
}
</style>
