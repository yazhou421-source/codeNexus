<template>
  <div class="center-empty-state native-home">
    <div v-if="loading || mode === 'pendingThread'" class="native-home-pending" role="status" aria-live="polite">
      <StatusIndicator
        state="loading"
        :label="loading ? t('centerEmpty.loadingMemory') : t('centerEmpty.creatingThread')"
      />
      <p>{{ t("centerEmpty.initializingContext") }}</p>
    </div>
    <template v-else>
      <div class="native-home-heading">
        <BrandLogo kind="symbol" />
        <h1>{{ projectName || "Calmnova Code" }}</h1>
        <StatusIndicator v-if="projectName" state="success" :label="zh ? '项目已就绪' : 'Project ready'" />
        <p v-else class="native-home-greeting">{{ greeting }}</p>
        <p>
          {{
            projectName
              ? zh
                ? "从一个问题开始，探索你的项目。"
                : "Start with a question about your project."
              : zh
                ? "准备好了，今天想做些什么？"
                : "Ready when you are."
          }}
        </p>
        <span v-if="projectName" class="native-home-path" :title="workspacePath">{{ workspacePath }}</span>
      </div>
      <div class="native-home-actions">
        <button class="native-home-action is-primary" type="button" @click="runtime.selectWorkspace()">
          <FolderOpen aria-hidden="true" /><strong>{{ zh ? "打开项目" : "Open Project" }}</strong>
          <span>{{ zh ? "选择工作区" : "Choose a workspace" }}</span>
        </button>
        <button class="native-home-action" type="button" @click="focusComposer">
          <SquarePen aria-hidden="true" /><strong>{{ zh ? "开始任务" : "Start a Task" }}</strong>
          <span>{{ zh ? "描述你想做的事" : "Describe your task" }}</span>
        </button>
        <button
          class="native-home-action"
          type="button"
          :aria-expanded="examplesOpen"
          @click="examplesOpen = !examplesOpen"
        >
          <Lightbulb aria-hidden="true" /><strong>{{ zh ? "探索示例" : "Explore Examples" }}</strong>
          <span>{{ zh ? "寻找任务灵感" : "Find a starting point" }}</span>
        </button>
      </div>
      <div v-if="examplesOpen" class="native-home-examples">
        <button v-for="example in examples" :key="example" type="button" @click="useExample(example)">
          {{ example }}<ArrowUpRight aria-hidden="true" />
        </button>
      </div>
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowUpRight, FolderOpen, Lightbulb, SquarePen } from "lucide-vue-next";
import type { ThreadHistoryItem } from "../../domain/types";
import { getRuntimeOrchestrator } from "../../domain/runtimeOrchestrator";
import { useRuntimeStore } from "../../stores/runtime.store";
import BrandLogo from "../brand/BrandLogo.vue";
import StatusIndicator from "../ui/StatusIndicator.vue";
defineProps<{ loading: boolean; historyItems: ThreadHistoryItem[]; mode: "default" | "pendingThread" }>();
defineEmits<{ (event: "switch-thread", threadId: string): void }>();
const { t, locale } = useI18n();
const runtime = getRuntimeOrchestrator();
const runtimeStore = useRuntimeStore();
const zh = computed(() => locale.value.startsWith("zh"));
const workspacePath = computed(() => String(runtimeStore.workspacePath || ""));
const projectName = computed(() => workspacePath.value.split(/[\\/]/).filter(Boolean).at(-1) || "");
const examplesOpen = ref(false);
const greeting = computed(() => {
  const hour = new Date().getHours();
  return zh.value
    ? hour < 12
      ? "早上好"
      : hour < 18
        ? "下午好"
        : "晚上好"
    : hour < 12
      ? "Good morning"
      : hour < 18
        ? "Good afternoon"
        : "Good evening";
});
const examples = computed(() =>
  zh.value
    ? ["请分析这个项目的结构，不修改文件。", "帮我梳理这个项目的启动和测试方法。", "审查当前改动，指出潜在问题。"]
    : [
        "Explain this project's structure without changing files.",
        "Explain how to run and test this project.",
        "Review the current changes for potential issues.",
      ]
);
function focusComposer() {
  document.getElementById("input")?.focus();
}
function useExample(text: string) {
  const input = document.getElementById("input");
  if (!input || input.textContent?.trim()) {
    focusComposer();
    return;
  }
  input.textContent = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  focusComposer();
}
</script>
