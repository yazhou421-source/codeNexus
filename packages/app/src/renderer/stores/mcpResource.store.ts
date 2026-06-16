import { defineStore } from "./zustandCompat";
import type {
  McpResourceParameterEntry,
  McpResourceReadLoadState,
  McpResourceReadResultState,
  McpResourceTemplateDraftState,
  McpResourceViewerTab,
} from "../domain/types";

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function toCacheKey(threadIdValue: unknown, serverIdValue: unknown, uriValue: unknown): string {
  const threadId = normalizeText(threadIdValue);
  const serverId = normalizeText(serverIdValue);
  const uri = normalizeText(uriValue);
  return threadId && serverId && uri ? `${threadId}::${serverId}::${uri}` : "";
}

function cloneParameterEntries(entries: McpResourceParameterEntry[] | null | undefined): McpResourceParameterEntry[] {
  return Array.isArray(entries)
    ? entries.map((entry) => ({
        key: normalizeText(entry?.key),
        value: String(entry?.value ?? ""),
      }))
    : [];
}

function cloneReadResult(result: McpResourceReadResultState | null): McpResourceReadResultState | null {
  if (!result) return null;
  return {
    ...result,
    contents: [...result.contents],
    toolNames: Array.isArray(result.toolNames) ? [...result.toolNames] : [],
    parameterEntries: cloneParameterEntries(result.parameterEntries),
  };
}

export const useMcpResourceStore = defineStore("mcpResource", {
  state: () => ({
    selectedServerId: "" as string,
    activeTab: "resources" as McpResourceViewerTab,
    selectedResourceUri: "" as string,
    selectedTemplateKey: "" as string,
    selectedContentIndex: 0,
    loadState: "idle" as McpResourceReadLoadState,
    errorText: "" as string,
    currentResult: null as McpResourceReadResultState | null,
    cacheByKey: {} as Record<string, McpResourceReadResultState>,
    templateDraftByKey: {} as Record<string, McpResourceTemplateDraftState>,
  }),
  getters: {
    cacheKeyForSelection(state) {
      return (threadIdValue: unknown, serverIdValue?: unknown, uriValue?: unknown) => {
        return toCacheKey(
          threadIdValue,
          serverIdValue ?? state.selectedServerId,
          uriValue ?? state.selectedResourceUri
        );
      };
    },
    getTemplateDraft(state) {
      return (templateKeyValue: unknown): McpResourceTemplateDraftState => {
        const templateKey = normalizeText(templateKeyValue);
        const existing = templateKey ? state.templateDraftByKey[templateKey] : null;
        return existing ?? { values: {}, manualUri: "" };
      };
    },
    getResourceCacheStats(state) {
      return () => {
        const values = Object.values(state.cacheByKey ?? {});
        let bytes = 0;
        for (const value of values) bytes += JSON.stringify(value).length;
        return {
          items: values.length,
          bytes,
          updatedAt: Date.now(),
        };
      };
    },
  },
  actions: {
    requestOpen(serverIdValue: unknown, tab: McpResourceViewerTab = "resources") {
      const serverId = normalizeText(serverIdValue);
      this.selectedServerId = serverId;
      this.activeTab = tab;
    },
    setSelectedServer(serverIdValue: unknown) {
      const serverId = normalizeText(serverIdValue);
      if (this.selectedServerId === serverId) return;
      this.selectedServerId = serverId;
      this.selectedResourceUri = "";
      this.selectedTemplateKey = "";
      this.selectedContentIndex = 0;
      this.loadState = "idle";
      this.errorText = "";
      this.currentResult = null;
    },
    setActiveTab(tab: McpResourceViewerTab) {
      if (this.activeTab === tab) return;
      this.activeTab = tab;
      this.selectedContentIndex = 0;
      this.errorText = "";
      this.currentResult = null;
      this.loadState = "idle";
    },
    selectResource(serverIdValue: unknown, uriValue: unknown) {
      this.selectedServerId = normalizeText(serverIdValue);
      this.activeTab = "resources";
      this.selectedResourceUri = normalizeText(uriValue);
      this.selectedTemplateKey = "";
      this.selectedContentIndex = 0;
      this.currentResult = null;
      this.loadState = "idle";
      this.errorText = "";
    },
    selectTemplate(serverIdValue: unknown, templateKeyValue: unknown) {
      this.selectedServerId = normalizeText(serverIdValue);
      this.activeTab = "templates";
      this.selectedTemplateKey = normalizeText(templateKeyValue);
      this.selectedResourceUri = "";
      this.selectedContentIndex = 0;
      this.currentResult = null;
      this.loadState = "idle";
      this.errorText = "";
    },
    setSelectedContentIndex(next: number) {
      const index = Number.isFinite(next) ? Math.max(0, Math.trunc(next)) : 0;
      this.selectedContentIndex = index;
    },
    setTemplateField(templateKeyValue: unknown, fieldKeyValue: unknown, value: unknown) {
      const templateKey = normalizeText(templateKeyValue);
      const fieldKey = normalizeText(fieldKeyValue);
      if (!templateKey || !fieldKey) return;
      const existing = this.templateDraftByKey[templateKey] ?? { values: {}, manualUri: "" };
      this.templateDraftByKey = {
        ...this.templateDraftByKey,
        [templateKey]: {
          ...existing,
          values: {
            ...existing.values,
            [fieldKey]: String(value ?? ""),
          },
        },
      };
    },
    setTemplateManualUri(templateKeyValue: unknown, uriValue: unknown) {
      const templateKey = normalizeText(templateKeyValue);
      if (!templateKey) return;
      const existing = this.templateDraftByKey[templateKey] ?? { values: {}, manualUri: "" };
      this.templateDraftByKey = {
        ...this.templateDraftByKey,
        [templateKey]: {
          ...existing,
          manualUri: String(uriValue ?? ""),
        },
      };
    },
    setLoadState(next: McpResourceReadLoadState, errorText = "") {
      this.loadState = next;
      this.errorText = errorText;
      if (next !== "ready") this.selectedContentIndex = 0;
    },
    setCurrentResult(result: McpResourceReadResultState | null, opts?: { cache?: boolean }) {
      const cloned = cloneReadResult(result);
      this.currentResult = cloned;
      this.selectedContentIndex = 0;
      if (!cloned || opts?.cache === false) return;
      const key = toCacheKey(cloned.threadId, cloned.serverId, cloned.uri);
      if (!key) return;
      this.cacheByKey = {
        ...this.cacheByKey,
        [key]: cloneReadResult(cloned)!,
      };
    },
    hydrateFromCache(threadIdValue: unknown, serverIdValue?: unknown, uriValue?: unknown): boolean {
      const key = toCacheKey(
        threadIdValue,
        serverIdValue ?? this.selectedServerId,
        uriValue ?? this.selectedResourceUri
      );
      if (!key) return false;
      const cached = this.cacheByKey[key];
      if (!cached) return false;
      this.currentResult = cloneReadResult(cached);
      this.loadState = "ready";
      this.errorText = "";
      this.selectedContentIndex = 0;
      return true;
    },
    clearResult() {
      this.currentResult = null;
      this.selectedContentIndex = 0;
      this.loadState = "idle";
      this.errorText = "";
    },
    clearResourceCache() {
      this.cacheByKey = {};
      if (this.currentResult) {
        this.currentResult = null;
        this.selectedContentIndex = 0;
        this.loadState = "idle";
        this.errorText = "";
      }
    },
    resetState() {
      this.selectedServerId = "";
      this.activeTab = "resources";
      this.selectedResourceUri = "";
      this.selectedTemplateKey = "";
      this.selectedContentIndex = 0;
      this.loadState = "idle";
      this.errorText = "";
      this.currentResult = null;
      this.templateDraftByKey = {};
    },
  },
});
