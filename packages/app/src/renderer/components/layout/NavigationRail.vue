<template>
  <nav class="navigation-rail" :aria-label="zh ? '工作区导航' : 'Workspace navigation'">
    <BrandLogo kind="symbol" />
    <button
      type="button"
      :title="zh ? '新对话' : 'New Chat'"
      :aria-label="zh ? '新对话' : 'New Chat'"
      @click="runtime.createThread()"
    >
      <SquarePen />
    </button>
    <button
      type="button"
      :class="{ 'is-active': shell.leftSidebarVisible }"
      :title="zh ? '历史对话' : 'History'"
      :aria-label="zh ? '历史对话' : 'History'"
      :aria-pressed="shell.leftSidebarVisible"
      @click="shell.toggleLeftSidebarVisible({ save: false })"
    >
      <MessageSquare />
    </button>
    <button
      type="button"
      :class="{ 'is-active': shell.filesSidebarVisible }"
      :title="zh ? '项目文件' : 'Files'"
      :aria-label="zh ? '项目文件' : 'Files'"
      :aria-pressed="shell.filesSidebarVisible"
      @click="shell.toggleFilesSidebarVisible({ save: false })"
    >
      <FolderClosed />
    </button>
    <button
      type="button"
      :title="zh ? 'Skills 与 MCP' : 'Skills & MCP'"
      :aria-label="zh ? 'Skills 与 MCP' : 'Skills & MCP'"
      @click="shell.openSettings('integrations')"
    >
      <Bot />
    </button>
    <span class="navigation-rail-spacer"></span>
    <button
      type="button"
      :title="t('topbar.openSettings')"
      :aria-label="t('topbar.openSettings')"
      @click="shell.openSettings('global')"
    >
      <Settings />
    </button>
  </nav>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Bot, FolderClosed, MessageSquare, Settings, SquarePen } from "lucide-vue-next";
import BrandLogo from "../brand/BrandLogo.vue";
import { useAppShellStore } from "../../stores/appShell.store";
import { getRuntimeOrchestrator } from "../../domain/runtimeOrchestrator";
const shell = useAppShellStore();
const runtime = getRuntimeOrchestrator();
const { t, locale } = useI18n();
const zh = computed(() => locale.value.startsWith("zh"));
</script>
