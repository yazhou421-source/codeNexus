import type { RouterConfig, RouterStartResult, RouterStartStatus } from "@codenexus/router";

export function externalRouterConfigAllowed(args: { isDev: boolean; isPackaged: boolean }): boolean {
  return args.isDev && !args.isPackaged;
}

export function shouldStopEmbeddedRouterOnWindowClose(platform: NodeJS.Platform): boolean {
  return platform !== "darwin";
}

export function routerStartAcquired(status: RouterStartStatus): boolean {
  return status === "started" || status === "already-running";
}

export async function startEmbeddedRouterFailSoft(args: {
  resolveConfig: () => { config: RouterConfig; source: string };
  start: (config: RouterConfig) => Promise<RouterStartResult>;
  info: (message: string) => void;
  warn: (message: string, error?: unknown) => void;
}): Promise<RouterStartResult | null> {
  try {
    const { config, source } = args.resolveConfig();
    const result = await args.start(config);
    if (!routerStartAcquired(result.status)) {
      args.warn(`startup did not acquire ${result.origin}: ${result.status}; existing Codex mode remains available`);
      return result;
    }
    args.info(`${result.status} at ${result.origin} (config: ${source})`);
    return result;
  } catch (error) {
    args.warn("startup failed; continuing without the embedded Router", error);
    return null;
  }
}
