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

  async read(): Promise<SafeAccountStatus> {
    const serverId = await this.ensureServer();
    try {
      const result = await this.serverManager.request({
        serverId,
        method: "account/read",
        params: { refreshToken: false },
      });
      return safeAccountStatus(result);
    } catch {
      throw accountFlowError("agent_unavailable");
    }
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
    if (!("method" in message) || message.method !== "account/login/completed") return;
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
  code: "agent_unavailable" | "login_start_failed" | "login_cancel_failed"
): Error & { code: string } {
  const message =
    code === "agent_unavailable"
      ? "AI Agent component could not start. Reinstall the application."
      : code === "login_cancel_failed"
        ? "ChatGPT login could not be cancelled. Please try again."
        : "ChatGPT login could not start. Please try again.";
  return Object.assign(new Error(message), { code });
}
