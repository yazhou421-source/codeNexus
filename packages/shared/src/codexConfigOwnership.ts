/** Runtime-only identities must never be imported as persistent user profiles. */
export function isCalmnovaRouterProvider(value: unknown): boolean {
  return typeof value === "string" && /^codenexus-router(?:-codex)?$/.test(value.trim());
}

export function isCalmnovaCodexEndpoint(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      /^\/codex-auth\/v1\/?$/.test(url.pathname) && !url.username && !url.password;
  } catch { return false; }
}
