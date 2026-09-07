<template>
  <main class="acceptance-fixture">
    <h1>Calmnova Code · Provider 状态验收</h1>
    <p class="fixture-notice">测试状态 · 内存组件 fixture，不代表真实 Provider 连接。未读取或填写 API Key。</p>
    <table>
      <thead>
        <tr>
          <th>测试情景</th>
          <th>Credential</th>
          <th>Connection</th>
          <th>Last checked</th>
          <th>Model availability</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.label">
          <th>{{ row.label }}</th>
          <td>
            <StatusIndicator :state="row.view.credential" :label="row.provider.configured ? '已配置' : '未配置'" />
          </td>
          <td><StatusIndicator :state="row.view.connection" :label="row.connectionLabel" /></td>
          <td>{{ row.view.lastChecked || "暂无时间记录" }}</td>
          <td>{{ row.view.selectable ? "可选择" : "不可用" }}</td>
        </tr>
      </tbody>
    </table>
    <p>实际 Model Picker 组件：不可用模型保留在列表中，以文字、图标和禁用样式区分。</p>
    <ComposerModelReasoningPicker
      v-model:model="model"
      v-model:reasoningEffort="effort"
      :modelOptions="options"
      :reasoningEffortOptions="[{ value: 'medium', label: '标准' }]"
    />
  </main>
</template>
<script setup lang="ts">
import { ref } from "vue";
import type { RouterProviderStatus } from "@codenexus/shared/ipc/contracts";
import { providerPresentation } from "../domain/providerPresentation";
import StatusIndicator from "../components/ui/StatusIndicator.vue";
import ComposerModelReasoningPicker from "../components/layout/composer/ComposerModelReasoningPicker.vue";
const model = ref("available-model"),
  effort = ref("medium");
const inputs = [
  ["Configured + Available", true, "verified", null, "连接已验证"],
  ["Configured + Unavailable", true, "failed", "PROVIDER_UNAVAILABLE", "服务不可用"],
  ["Configured + Validation Failed", true, "failed", "INVALID_API_KEY", "验证失败"],
  ["Not Configured", false, "untested", null, "尚未配置"],
  ["Checking", true, "testing", null, "检查中"],
] as const;
const rows = inputs.map(([label, configured, state, errorCode, connectionLabel]) => {
  const provider: RouterProviderStatus = {
    id: label,
    displayName: label,
    baseUrl: "",
    api: "responses",
    requiresApiKey: true,
    configured,
    enabled: true,
    defaultModelId: "",
    models: [],
    verification: { state, errorCode, verifiedAt: state === "verified" ? "2026-09-07T00:00:00Z（测试时间）" : null },
  };
  return { label, provider, connectionLabel, view: providerPresentation(provider) };
});
const options = rows
  .filter((row) => row.provider.configured)
  .map((row, index) => ({
    value: index === 0 ? "available-model" : `test-model-${index}`,
    label: row.label,
    disabled: !row.view.selectable,
  }));
</script>
<style scoped>
.acceptance-fixture {
  max-width: 1050px;
  margin: 56px auto;
  padding: 24px;
  color: var(--text-main);
}
h1 {
  font-size: 20px;
  margin-bottom: 16px;
}
.fixture-notice {
  padding: 12px;
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
}
table {
  margin: 24px 0;
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  text-align: left;
}
th,
td {
  padding: 14px 8px;
  border-bottom: 1px solid var(--border-default);
}
th {
  font-weight: 500;
}
p {
  margin-bottom: 20px;
  font-size: 13px;
}
</style>
