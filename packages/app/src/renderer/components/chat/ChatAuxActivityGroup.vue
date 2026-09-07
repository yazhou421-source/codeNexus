<template>
  <div :class="[CHAT_ROW_BASE_CLASS, 'chat-row--aux-activity']">
    <section
      class="task-progress"
      :class="{ 'is-running': isRunning, 'is-supplemental': !isRunning && !answerStartedAtMs && !hasError }"
      :aria-label="zh ? '任务进度' : 'Task progress'"
    >
      <header class="task-progress-header">
        <span class="task-progress-brand"><BrandLogo kind="symbol" />Calmnova</span>
        <span class="task-progress-elapsed">{{ elapsedText }}</span>
      </header>
      <div class="task-progress-current" role="status" aria-live="polite">
        <StatusIndicator :state="currentState" :label="currentTitle" />
        <span v-if="completedCount">{{
          zh ? `已完成 ${completedCount} 个步骤` : `${completedCount} steps completed`
        }}</span>
      </div>
      <div v-if="isRunning" class="task-progress-phases" :aria-label="zh ? '当前工作阶段' : 'Workflow stage'">
        <span :class="{ active: currentState === 'thinking' && !answerStartedAtMs }">{{ zh ? "分析" : "Analyze" }}</span
        ><ArrowRight aria-hidden="true" />
        <span :class="{ active: currentState === 'executing' }">{{ zh ? "执行" : "Execute" }}</span
        ><ArrowRight aria-hidden="true" />
        <span :class="{ active: !!answerStartedAtMs }">{{ zh ? "结果" : "Result" }}</span>
      </div>
      <aside
        v-if="isRunning && workspaceRoot"
        class="task-progress-context"
        :aria-label="zh ? '项目上下文' : 'Project context'"
      >
        <h3>{{ zh ? "项目上下文" : "Project context" }}</h3>
        <div class="task-context-project">
          <FolderClosed aria-hidden="true" /><strong>{{ workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) }}</strong>
        </div>
        <p class="task-context-path" :title="workspaceRoot">{{ workspaceRoot }}</p>
        <dl>
          <div>
            <dt>{{ zh ? "已记录操作" : "Observed operations" }}</dt>
            <dd>{{ observedSteps.length }}</dd>
          </div>
          <div>
            <dt>{{ zh ? "已完成步骤" : "Completed steps" }}</dt>
            <dd>{{ completedCount }}</dd>
          </div>
        </dl>
      </aside>
      <ol v-if="isRunning && visibleSteps.length" class="task-progress-steps">
        <li v-for="step in visibleSteps" :key="step.id" :class="`is-${step.state}`">
          <StatusIndicator :state="step.state" :label="step.title" />
          <span class="task-progress-step-meta"
            >{{ stepLabel(step)
            }}<template v-if="step.durationMs != null">
              · {{ Math.max(1, Math.round(step.durationMs / 1000)) }}s</template
            ></span
          >
        </li>
      </ol>
      <button
        class="task-progress-details-toggle"
        type="button"
        :aria-expanded="open"
        :aria-controls="detailsId"
        @click="toggleOpen"
      >
        <ChevronDown aria-hidden="true" :class="{ 'rotate-180': open }" /><span
          >{{ zh ? "详细过程" : "Activity details" }} · {{ items.length }}</span
        >
        <span>{{ zh ? "Thinking · Tools · Logs" : "Thinking · Tools · Logs" }}</span>
      </button>
      <div v-if="open" :id="detailsId" class="task-progress-details app-scrollbar">
        <div v-for="item in items" :key="item.id" :data-aux-kind="item.kind"><slot :item="item" /></div>
      </div>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ArrowRight, ChevronDown, FolderClosed } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { ChatAuxActivityStatus, ChatAuxActivitySummaryItem, ChatAuxiliaryRow } from "../layout/types/chat.types";
import { CHAT_ROW_BASE_CLASS } from "../layout/chat/chatPresentation";
import { buildTaskProgress, type ProgressStep } from "./taskProgress";
import BrandLogo from "../brand/BrandLogo.vue";
import StatusIndicator from "../ui/StatusIndicator.vue";
import { useThreadStore } from "../../stores/thread.store";
const props = defineProps<{
  id: string;
  items: ChatAuxiliaryRow[];
  summaryItems: ChatAuxActivitySummaryItem[];
  summaryText: string;
  status: ChatAuxActivityStatus;
  defaultCollapsed: boolean;
  startedAtMs: number | null;
  answerStartedAtMs: number | null;
  elapsedLive: boolean;
  workspaceRoot?: string;
}>();
defineSlots<{ default(props: { item: ChatAuxiliaryRow }): unknown }>();
const emit = defineEmits<{ (event: "layout-change"): void }>();
const { locale } = useI18n();
const threadStore = useThreadStore();
const zh = computed(() => locale.value.startsWith("zh"));
const open = ref(false);
const now = ref(Date.now());
const detailsId = computed(() => `activity-details-${props.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
const isRunning = computed(() => props.status === "running" || props.elapsedLive);
const observedSteps = computed(() => buildTaskProgress(props.items, isRunning.value, zh.value));
const steps = computed<ProgressStep[]>(() => {
  const plan = threadStore.currentTurnPlan;
  // A historical group must never borrow another turn's live plan.
  const id = props.items.find((row) => row.turnKey.startsWith("turn:"))?.turnKey.slice(5) || "";
  if (!plan || plan.turnId !== id || !plan.plan.length || !isRunning.value) return observedSteps.value;
  return plan.plan.map((step, index) => ({
    id: `plan-${index}`,
    title: step.step,
    pending: step.status === "pending",
    state: step.status === "completed" ? "success" : step.status === "inProgress" ? "executing" : "idle",
  }));
});
const visibleSteps = computed(() => steps.value.slice(-5));
const completedCount = computed(() => steps.value.filter((step) => step.state === "success").length);
const hasError = computed(() => observedSteps.value.some((step) => step.state === "error"));
const currentStep = computed(() =>
  [...steps.value].reverse().find((step) => step.state === "executing" || step.state === "thinking")
);
const currentState = computed(() =>
  props.status === "paused" || (hasError.value && !isRunning.value)
    ? "warning"
    : isRunning.value
      ? currentStep.value?.state || "thinking"
      : props.answerStartedAtMs
        ? "success"
        : "idle"
);
const currentTitle = computed(() => {
  if (props.status === "paused") return zh.value ? "任务已暂停" : "Task paused";
  if (isRunning.value) return currentStep.value?.title || (zh.value ? "正在分析任务…" : "Analyzing the task…");
  if (hasError.value) return zh.value ? "执行记录中有错误，请查看详情" : "Some operations failed. Review details.";
  return props.answerStartedAtMs
    ? zh.value
      ? "执行完成 · 结果如下"
      : "Activity complete · Results below"
    : zh.value
      ? "执行过程已结束"
      : "Activity ended";
});
const elapsedText = computed(() => {
  if (!props.startedAtMs) return "";
  const end = props.answerStartedAtMs || (props.elapsedLive ? now.value : null);
  return end ? `${Math.max(1, Math.round((end - props.startedAtMs) / 1000))}s` : "";
});
function stepLabel(step: ProgressStep) {
  const state = step.state;
  if (state === "idle") return step.pending ? (zh.value ? "等待中" : "Pending") : zh.value ? "已记录" : "Recorded";
  return zh.value
    ? { idle: "已记录", thinking: "思考中", executing: "执行中", success: "已完成", warning: "需关注", error: "失败" }[
        state
      ]
    : {
        idle: "Recorded",
        thinking: "Thinking",
        executing: "Executing",
        success: "Completed",
        warning: "Needs attention",
        error: "Failed",
      }[state];
}
async function toggleOpen() {
  open.value = !open.value;
  await nextTick();
  emit("layout-change");
}
let timer: ReturnType<typeof setInterval> | null = null;
watch(
  () => props.elapsedLive,
  (live) => {
    if (timer) clearInterval(timer);
    timer = live
      ? setInterval(() => {
          now.value = Date.now();
        }, 1000)
      : null;
  },
  { immediate: true }
);
watch(
  () => props.id,
  () => {
    open.value = false;
  }
);
watch(
  () => [props.items.length, props.status],
  () => {
    void nextTick(() => emit("layout-change"));
  }
);
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>
