import type { CodexIncomingMessage } from "@codenexus/shared/codex-protocol";
import type { SafeAccountLoginCompleted, SafeAccountStatus } from "@codenexus/shared/ipc/contracts";
import { normalizeSafeExternalUrl } from "../utils/externalUrl";
import type { CodexServerManager } from "./CodexServerManager";

type LoginStartResult = { authUrl: string };

export class CodexAccountService {
  private serverId = "";
  private serverPromise: Promise<string> | null = null;
  private pendingLoginId = "";
  private readonly loginListeners = new Set<(payload: SafeAccountLoginCompleted) => void>();

  constructor(
    private readonly serverManager: CodexServerManager,
    private readonly cwd: string
  ) {}

  onLoginCompleted(listener: (payload: SafeAccountLoginCompleted) => void): () => void {
    this.loginListeners.add(listener);
    return () => this.loginListeners.delete(listener);
  }

  private readPromise: Promise<SafeAccountStatus> | null = null;

  async read(): Promise<SafeAccountStatus> {
    if (!this.readPromise)
      this.readPromise = this.readVerified().finally(() => {
        this.readPromise = null;
      });
    return this.readPromise;
  }

  private async readVerified(): Promise<SafeAccountStatus> {
    const serverId = await this.ensureServer();
    let account: SafeAccountStatus;
    try {
      account = safeAccountStatus(
        await this.serverManager.request({ serverId, method: "account/read", params: { refreshToken: false } })
      );
      if (account.state === "logged_in") {
        try {
          await this.serverManager.request({ serverId, method: "account/rateLimits/read", params: undefined });
        } catch (error) {
          if (!isAccountAuthFailure(error)) throw error;
          // An expired access token may still be renewable. Let Codex perform
          // its own refresh once; no credential is read or exported here.
          account = safeAccountStatus(
            await this.serverManager.request({ serverId, method: "account/read", params: { refreshToken: true } })
          );
          if (account.state !== "logged_in") throw new Error("authentication required");
          await this.serverManager.request({ serverId, method: "account/rateLimits/read", params: undefined });
        }
      }
    } catch (error) {
      if (!isAccountAuthFailure(error)) throw accountFlowError("account_check_failed");
      account = { state: "expired", email: null, planType: null, requiresOpenaiAuth: true };
    }
    let credentialStorage: SafeAccountStatus["credentialStorage"] = "unknown";
    try {
      const { config } = await this.serverManager.request({
        serverId,
        method: "config/read",
        params: { includeLayers: false },
      });
      const mode = config.cli_auth_credentials_store;
      if (mode === "file" || mode === "keyring" || mode === "auto") credentialStorage = mode;
    } catch {
      /* Source metadata failure does not change verified authentication. */
    }
    return {
      ...account,
      checkedAt: Date.now(),
      credentialHome: process.env.CODEX_HOME ? "environment" : "default",
      credentialStorage,
    };
  }

  async startChatGptLogin(): Promise<LoginStartResult> {
    const serverId = await this.ensureServer();
    if (this.pendingLoginId) await this.cancelLogin();
    let result;
    try {
      result = await this.serverManager.request({
        serverId,
        method: "account/login/start",
        params: {
          type: "chatgpt",
          appBrand: "codex",
          useHostedLoginSuccessPage: true,
        },
      });
    } catch {
      throw accountFlowError("login_start_failed");
    }
    if (result.type !== "chatgpt") throw accountFlowError("login_start_failed");
    const loginId = String(result.loginId ?? "").trim();
    const authUrl = safeHttpsUrl(result.authUrl);
    if (!loginId || !authUrl) throw accountFlowError("login_start_failed");
    this.pendingLoginId = loginId;
    return { authUrl };
  }

  async cancelLogin(): Promise<{ ok: true }> {
    const loginId = this.pendingLoginId;
    if (!loginId || !this.serverId) return { ok: true };
    try {
      await this.serverManager.request({
        serverId: this.serverId,
        method: "account/login/cancel",
        params: { loginId },
      });
    } catch {
      throw accountFlowError("login_cancel_failed");
    }
    if (this.pendingLoginId === loginId) this.pendingLoginId = "";
    return { ok: true };
  }

  private async ensureServer(): Promise<string> {
    if (this.serverId) return this.serverId;
    if (!this.serverPromise) {
      this.serverPromise = this.serverManager
        .start({ cwd: this.cwd, experimentalApi: true, onMessage: (payload) => this.handleMessage(payload.msg) })
        .then((result) => {
          const serverId = String(result.serverId ?? "").trim();
          if (!serverId) throw accountFlowError("agent_unavailable");
          this.serverId = serverId;
          return serverId;
        })
        .catch(() => {
          throw accountFlowError("agent_unavailable");
        })
        .finally(() => {
          this.serverPromise = null;
        });
    }
    return await this.serverPromise;
  }

  private handleMessage(message: CodexIncomingMessage): void {
    if (!("method" in message)) return;
    if (message.method === "codex/exit") {
      this.serverId = "";
      return;
    }
    if (message.method !== "account/login/completed") return;
    const params = message.params;
    const loginId = String(params.loginId ?? "").trim();
    if (this.pendingLoginId && loginId && loginId !== this.pendingLoginId) return;
    this.pendingLoginId = "";
    const payload = { success: params.success === true };
    for (const listener of this.loginListeners) listener(payload);
  }
}

function safeAccountStatus(value: unknown): SafeAccountStatus {
  const response = record(value);
  const account = record(response?.account);
  const loggedIn = account?.type === "chatgpt";
  return {
    state: loggedIn ? "logged_in" : "logged_out",
    email: loggedIn && typeof account.email === "string" ? account.email.slice(0, 320) : null,
    planType: loggedIn && typeof account.planType === "string" ? account.planType.slice(0, 80) : null,
    requiresOpenaiAuth: Boolean(response?.requiresOpenaiAuth),
  };
}

function safeHttpsUrl(value: unknown): string {
  const normalized = normalizeSafeExternalUrl(String(value ?? ""));
  if (!normalized) return "";
  try {
    return new URL(normalized).protocol === "https:" ? normalized : "";
  } catch {
    return "";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function accountFlowError(
  code: "agent_unavailable" | "login_start_failed" | "login_cancel_failed" | "account_check_failed"
): Error & { code: string } {
  const message =
    code === "account_check_failed"
      ? "Account authentication could not be verified. Check the network and try again."
      : code === "agent_unavailable"
        ? "AI Agent component could not start. Reinstall the application."
        : code === "login_cancel_failed"
          ? "ChatGPT login could not be cancelled. Please try again."
          : "ChatGPT login could not start. Please try again.";
  return Object.assign(new Error(message), { code });
}

// Match authentication failures only. A timeout, 403 policy denial, or exhausted
// quota must not be reported as an expired login. Never forward raw RPC errors.
function isAccountAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /\b401\b|refresh_token_(?:expired|reused|invalidated)|refresh token[^.]*?(?:expired|invalid)|authentication required|please (?:log|sign) in again/i.test(
    message
  );
}
