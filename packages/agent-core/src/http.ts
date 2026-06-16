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
  /**
   * 瞬时错误（429/502/503/504 + 网络抖动）的最大重试次数，默认 3。设 0 关闭重试。
   * 重试在发送 body（请求体）前进行，对流式与非流式同样安全。
   */
  maxRetries?: number;
};

/** 可重试的瞬时 HTTP 状态：限流与网关类故障。其余（含 4xx）一律不重试。 */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
/** 退避基数与上限（毫秒）：指数增长并叠加 jitter，封顶避免长时间挂起。 */
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 计算下一次重试前的等待毫秒数。
 * 优先尊重服务端 Retry-After（秒数或 HTTP 日期），否则用带 jitter 的指数退避。
 */
function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, RETRY_MAX_DELAY_MS);
    }
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) {
      return Math.min(Math.max(dateMs - Date.now(), 0), RETRY_MAX_DELAY_MS);
    }
  }
  const expo = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  // full jitter：[0, expo) 间均匀抖动，避免多个请求同时重试形成尖峰。
  return Math.random() * expo;
}

/** 该错误是否为「值得重试」的网络层抖动（连接重置/超时等，但不含外部主动取消）。 */
function isRetryableNetworkError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  if (error instanceof Error && error.name === "TimeoutError") return false;
  if (error instanceof Error && error.name === "AbortError") return false;
  return error instanceof TypeError; // fetch 在网络故障时抛 TypeError
}

/**
 * max_tokens 超限类 400：模型输出上限低于请求的 max_tokens。
 * 各家文案不一，这里做关键词嗅探，命中则把原始报错包装成可执行的指引。
 */
function isMaxTokensRejection(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const text = body.toLowerCase();
  return (
    (text.includes("max_tokens") ||
      text.includes("maxoutputtokens") ||
      text.includes("max output tokens") ||
      text.includes("max_output_tokens")) &&
    (text.includes("exceed") ||
      text.includes("less than") ||
      text.includes("greater than") ||
      text.includes("maximum") ||
      text.includes("at most") ||
      text.includes("limit") ||
      text.includes("too large") ||
      text.includes("range"))
  );
}

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

/** POST 一段 JSON 并在非 2xx 时抛错；返回 Response 供调用方 .json() 或按 SSE 读取。
 *
 * 瞬时错误（429/502/503/504 与网络抖动）按带 jitter 的指数退避有界重试，
 * 尊重服务端 Retry-After；其余错误（含一般 4xx）立即抛出。
 * 重试发生在读取响应体之前，对流式与非流式都安全。 */
export async function postJson(
  url: string,
  options: PostJsonOptions,
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  let attempt = 0;

  for (;;) {
    // 每次尝试用独立的超时信号（与外部取消信号合并）。
    const signal = composeSignal(options.timeoutMs, options.signal);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.stream ? { accept: "text/event-stream" } : {}),
          ...options.headers,
        },
        body: JSON.stringify(options.body),
        signal,
      });
    } catch (error: unknown) {
      // 外部主动取消 / 超时不重试，原样抛出。
      if (
        attempt < maxRetries &&
        isRetryableNetworkError(error, options.signal)
      ) {
        await sleep(retryDelayMs(attempt, null), options.signal);
        attempt += 1;
        continue;
      }
      throw error;
    }

    if (response.ok) return response;

    // 可重试状态：未超次数则退避后重试（消费 body 以释放连接）。
    if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
      const retryAfter = response.headers.get("retry-after");
      await response.body?.cancel().catch(() => {});
      await sleep(retryDelayMs(attempt, retryAfter), options.signal);
      attempt += 1;
      continue;
    }

    const text = await response.text().catch(() => "");
    // max_tokens 超限类 400：把模型上限低于请求值这一真因翻译成可执行指引。
    if (isMaxTokensRejection(response.status, text)) {
      throw new Error(
        `${options.errorLabel} failed (${response.status}): 该模型的最大输出 tokens 低于请求值。` +
          `请在 provider 配置中调小 maxOutputTokens（如 8192 或 4096）后重试。原始错误：${text.slice(0, 300)}`,
      );
    }
    throw new Error(
      `${options.errorLabel} failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
}
