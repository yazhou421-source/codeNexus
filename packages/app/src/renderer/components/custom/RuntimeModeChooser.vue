<template>
  <div class="mode-chooser">
    <div class="mode-chooser__panel">
      <header class="mode-chooser__head">
        <h1>选择运行模式</h1>
        <p>Calmnova Code 正在逐步完善新的模型接入方式。你可以继续使用稳定模式，或体验直连自定义 Provider。</p>
      </header>
      <div class="mode-chooser__cards">
        <button type="button" class="mode-card" @click="choose('codex')">
          <span class="mode-card__badge">稳定</span>
          <h2>旧版 · Codex App Server</h2>
          <p>通过本地 codex app-server 运行，拥有完整的审批 / 工作区 / MCP / 技能能力。</p>
        </button>
        <button type="button" class="mode-card mode-card--accent" @click="choose('custom')">
          <span class="mode-card__badge">实验</span>
          <h2>新版 · 自定义 Provider</h2>
          <p>直连 OpenAI 兼容接口（Claude / Gemini 后续支持），不依赖 codex-app-server。</p>
        </button>
      </div>
      <footer v-if="canCancel" class="mode-chooser__foot">
        <button type="button" class="mode-chooser__cancel" @click="cancel">取消</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAppShellStore } from "../../stores/appShell.store";
import type { RuntimeMode } from "@codenexus/shared/localSettings";

const appShellStore = useAppShellStore();
// 仅在已选择过模式（切换场景）时允许取消；首次启动必须做出选择。
const canCancel = computed(() => appShellStore.runtimeMode !== null);
const choose = (mode: RuntimeMode) => appShellStore.setRuntimeMode(mode);
const cancel = () => appShellStore.closeModeChooser();
</script>

<style scoped>
.mode-chooser {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: var(--ui-overlay-backdrop);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.mode-chooser__panel {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 32px;
  border-radius: 16px;
  color: var(--text);
  background: var(--surface-1);
  border: 1px solid var(--border);
  box-shadow: var(--ui-shadow-md, 0 18px 42px rgb(0 0 0 / 0.3));
}

.mode-chooser__head {
  text-align: center;
}

.mode-chooser__head h1 {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
}

.mode-chooser__head p {
  margin: 0 auto;
  max-width: 560px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
}

.mode-chooser__cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.mode-card {
  appearance: none;
  -webkit-appearance: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  min-height: 156px;
  padding: 18px;
  border-radius: 14px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  transition:
    transform 0.12s ease,
    border-color 0.12s ease,
    background 0.12s ease;
}

.mode-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-accent);
  background: var(--surface-3);
}

.mode-card:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.mode-card--accent {
  border-color: var(--border-success);
}

.mode-card--accent:hover {
  border-color: var(--border-success-hover);
}

.mode-card__badge {
  align-self: flex-start;
  font-size: 11px;
  line-height: 1;
  padding: 4px 9px;
  border-radius: 999px;
  color: var(--text-muted);
  background: var(--surface-3);
}

.mode-card--accent .mode-card__badge {
  color: var(--fg-success);
  background: var(--bg-success-soft);
}

.mode-card h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.mode-card p {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted);
}

.mode-chooser__foot {
  display: flex;
  justify-content: center;
}

.mode-chooser__cancel {
  appearance: none;
  font: inherit;
  cursor: pointer;
  padding: 8px 20px;
  border-radius: 10px;
  color: var(--text-muted);
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.mode-chooser__cancel:hover {
  color: var(--text);
  border-color: var(--border-accent);
  background: var(--surface-3);
}
</style>
