import type { ConfigReadResponse } from "@codenexus/generated/codex-app-server/v2/ConfigReadResponse";
import { isCalmnovaCodexEndpoint, isCalmnovaRouterProvider } from "@codenexus/shared/codexConfigOwnership";

/** config/read.config includes sessionFlags (-c). Never persist that merged view. */
export function importableCodexConfig(result: Pick<ConfigReadResponse, "layers">): Record<string, unknown> | null {
  const user = result.layers?.find(
    (layer) => layer.name.type === "user" && !layer.name.profile && !layer.disabledReason
  );
  const config = user?.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  if (isCalmnovaRouterProvider(config.model_provider) || isCalmnovaCodexEndpoint(config.openai_base_url)) return null;
  return config;
}
