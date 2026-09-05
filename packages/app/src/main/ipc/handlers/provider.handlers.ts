import { ipcMain } from "electron";
import { IPC_APP_CHANNELS } from "@codenexus/shared/ipc/channels";
import type { ProviderRuntimeService } from "../../services/ProviderRuntimeService";

export function registerProviderHandlers(deps: { providerRuntimeService: ProviderRuntimeService }): void {
  const service = deps.providerRuntimeService;

  ipcMain.handle(IPC_APP_CHANNELS.appRouterProvidersList, async () => service.list());

  ipcMain.handle(IPC_APP_CHANNELS.appRouterProviderSaveApiKey, async (_event, value: unknown) => {
    const args = record(value);
    if (typeof args?.providerId !== "string" || typeof args.apiKey !== "string") {
      throw new Error("Provider credential request is invalid.");
    }
    try {
      return await service.saveApiKey(args.providerId, args.apiKey);
    } catch (error) {
      throw sanitizedProviderError(error, args.apiKey);
    }
  });

  ipcMain.handle(IPC_APP_CHANNELS.appRouterProviderDeleteApiKey, async (_event, value: unknown) => {
    const args = record(value);
    if (typeof args?.providerId !== "string") throw new Error("Provider credential request is invalid.");
    try {
      return await service.deleteApiKey(args.providerId);
    } catch (error) {
      throw sanitizedProviderError(error);
    }
  });

  ipcMain.handle(IPC_APP_CHANNELS.appRouterProviderConfigure, async (_event, value: unknown) => {
    const args = record(value);
    if (
      typeof args?.providerId !== "string" ||
      typeof args.enabled !== "boolean" ||
      !Array.isArray(args.modelIds) ||
      args.modelIds.some((modelId) => typeof modelId !== "string")
    ) {
      throw new Error("Provider settings request is invalid.");
    }
    try {
      return await service.configure({
        providerId: args.providerId,
        enabled: args.enabled,
        modelIds: args.modelIds,
      });
    } catch (error) {
      throw sanitizedProviderError(error);
    }
  });

  ipcMain.handle(IPC_APP_CHANNELS.appRouterProviderTestConnection, async (_event, value: unknown) => {
    const args = record(value);
    if (typeof args?.providerId !== "string") throw new Error("Provider connection test request is invalid.");
    try {
      return await service.testConnection(args.providerId);
    } catch (error) {
      throw sanitizedProviderError(error);
    }
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function sanitizedProviderError(error: unknown, secret = ""): Error {
  const raw = error instanceof Error ? error.message : "Provider operation failed.";
  const message = secret ? raw.split(secret).join("[REDACTED]") : raw;
  const safeMessage = message.slice(0, 300) || "Provider operation failed.";
  const result = new Error(safeMessage);
  const code = record(error)?.code;
  if (typeof code === "string") Object.assign(result, { code });
  return result;
}
