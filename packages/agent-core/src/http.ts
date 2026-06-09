/**
 * 三家 ChatClient 共用的 HTTP 小工具：POST JSON + 超时（AbortController）+ 非 2xx 抛错。
 *
 * 把各 client 里重复的 fetch / 超时 / 错误处理收敛到一处；
 * 协议差异（鉴权头、body 形状、响应解析）仍由各 client 自己负责。
 */
export type PostJsonOptions = {
  /** 该家协议特有的请求头（鉴权等）；content-type 已由本函数补上。 */
  headers: Record<string, string>;
  body: unknown;
  /** 单次请求超时（毫秒）。 */
  timeoutMs: number;
  /** 报错前缀，如 "chat/completions" / "anthropic messages stream"。 */
  errorLabel: string;
  /** 流式请求：追加 Accept: text/event-stream。 */
  stream?: boolean;
  /** 外部取消信号。 */
  signal?: AbortSignal;
};

type AbortSignalConstructorWithHelpers = typeof AbortSignal & {
  timeout?: (milliseconds: number) => AbortSignal;
  any?: (signals: AbortSignal[]) => AbortSignal;
};

function timeoutSignal(timeoutMs: number): AbortSignal {
  const ctor = AbortSignal as AbortSignalConstructorWithHelpers;
  if (typeof ctor.timeout === "function") {
    return ctor.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => {
    const error = Object.assign(
      new Error(`Request timeout after ${timeoutMs}ms`),
      { name: "TimeoutError" },
    );
    controller.abort(error);
  }, timeoutMs);
  return controller.signal;
}

function composeSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const signals = signal
    ? [signal, timeoutSignal(timeoutMs)]
    : [timeoutSignal(timeoutMs)];
  if (signals.length === 1) return signals[0]!;

  const ctor = AbortSignal as AbortSignalConstructorWithHelpers;
  if (typeof ctor.any === "function") {
    return ctor.any(signals);
  }

  const controller = new AbortController();
  const abort = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  for (const source of signals) {
    if (source.aborted) {
      abort(source);
      break;
    }
    source.addEventListener("abort", () => abort(source), { once: true });
  }
  return controller.signal;
}

/** POST 一段 JSON 并在非 2xx 时抛错；返回 Response 供调用方 .json() 或按 SSE 读取。 */
export async function postJson(
  url: string,
  options: PostJsonOptions,
): Promise<Response> {
  const signal = composeSignal(options.timeoutMs, options.signal);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.stream ? { accept: "text/event-stream" } : {}),
      ...options.headers,
    },
    body: JSON.stringify(options.body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `${options.errorLabel} failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  return response;
}
