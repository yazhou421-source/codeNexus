import type { RouterProviderStatus } from "@codenexus/shared/ipc/contracts";
export function providerPresentation(provider: RouterProviderStatus) {
  const verification = provider.configured ? provider.verification?.state || "untested" : "untested";
  const connection =
    verification === "verified"
      ? "success"
      : verification === "failed"
        ? "unavailable"
        : verification === "testing"
          ? "loading"
          : "idle";
  return {
    credential: provider.configured ? ("success" as const) : ("idle" as const),
    connection,
    selectable: provider.configured && provider.enabled && verification !== "failed" && verification !== "testing",
    lastChecked: verification === "verified" ? provider.verification?.verifiedAt || null : null,
  } as const;
}
