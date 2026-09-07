import type { RouterModelRoute } from "./types";
export function testProviderConnection(
  route: RouterModelRoute,
  options?: {
    resolveSecret?: (secretRef: string) => string | undefined;
    timeoutMs?: number;
  },
): Promise<{
  ok: true;
  providerId: string;
  modelId: string;
  elapsedMs: number;
}>;
