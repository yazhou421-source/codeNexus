<template>
  <span class="status-indicator" :class="`status-indicator--${state}`">
    <component :is="icons[state]" aria-hidden="true" /><span>{{ label || labels[state] }}</span>
  </span>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  Circle,
  CircleCheck,
  CircleAlert,
  CircleX,
  LoaderCircle,
  Brain,
  PlayCircle,
  WifiOff,
  Ban,
} from "lucide-vue-next";
export type IndicatorState =
  | "idle"
  | "loading"
  | "thinking"
  | "executing"
  | "success"
  | "warning"
  | "error"
  | "offline"
  | "unavailable";
defineProps<{ state: IndicatorState; label?: string }>();
const { locale } = useI18n();
const icons = {
  idle: Circle,
  loading: LoaderCircle,
  thinking: Brain,
  executing: PlayCircle,
  success: CircleCheck,
  warning: CircleAlert,
  error: CircleX,
  offline: WifiOff,
  unavailable: Ban,
};
const labels = computed(() =>
  locale.value.startsWith("zh")
    ? {
        idle: "空闲",
        loading: "加载中",
        thinking: "思考中",
        executing: "执行中",
        success: "已完成",
        warning: "警告",
        error: "错误",
        offline: "离线",
        unavailable: "不可用",
      }
    : {
        idle: "Idle",
        loading: "Loading",
        thinking: "Thinking",
        executing: "Executing",
        success: "Completed",
        warning: "Warning",
        error: "Error",
        offline: "Offline",
        unavailable: "Unavailable",
      }
);
</script>
