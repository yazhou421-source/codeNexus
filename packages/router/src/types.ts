export type RouterApi = "responses" | "chat_completions";
export type RouterAuthMode = "api_key" | "codex_openai";

export type RouterModelRoute = {
  id: string;
  displayName: string;
  description?: string;
  api: RouterApi;
  baseUrl: string;
  model: string;
  authMode?: RouterAuthMode;
  apiKey?: string;
  apiKeyEnv?: string;
  [key: string]: unknown;
};

export type RouterConfig = {
  mode?: string;
  host?: string;
  port?: number;
  authToken?: string;
  clientAuth?: {
    allowOpenAiBearer?: boolean;
  };
  requestLimits?: {
    compressedBytes?: number;
    decompressedBytes?: number;
  };
  defaultModel?: string;
  catalog?: Record<string, unknown>;
  models: RouterModelRoute[];
  __path?: string;
  [key: string]: unknown;
};
