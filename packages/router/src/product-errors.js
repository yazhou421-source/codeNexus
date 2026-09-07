export const ProductErrorCode = Object.freeze({
  INVALID_API_KEY: "INVALID_API_KEY",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  RATE_LIMITED: "RATE_LIMITED",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  STREAM_INTERRUPTED: "STREAM_INTERRUPTED",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  SECURE_STORAGE_UNAVAILABLE: "SECURE_STORAGE_UNAVAILABLE",
  ROUTER_UNAVAILABLE: "ROUTER_UNAVAILABLE",
  AGENT_RUNTIME_UNAVAILABLE: "AGENT_RUNTIME_UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
});

const SAFE_MESSAGES = Object.freeze({
  INVALID_API_KEY: "The API key was rejected. Check the key and try again.",
  INSUFFICIENT_BALANCE:
    "This provider account has insufficient balance or quota.",
  RATE_LIMITED:
    "The provider is busy or rate limited. Wait a moment and try again.",
  MODEL_UNAVAILABLE:
    "This model is unavailable for the current provider account.",
  PROVIDER_UNAVAILABLE:
    "The AI provider is temporarily unavailable. Try again later.",
  NETWORK_ERROR:
    "Calmnova Code could not reach the AI provider. Check your network and proxy settings.",
  TIMEOUT: "The AI provider did not respond in time. Try again.",
  STREAM_INTERRUPTED:
    "The AI response was interrupted before it completed. Try again.",
  INVALID_RESPONSE:
    "The AI provider returned an invalid response. Try another model or try again later.",
  PROVIDER_NOT_CONFIGURED:
    "Save an API key for this AI provider before using it.",
  SECURE_STORAGE_UNAVAILABLE:
    "Secure credential storage is unavailable on this computer.",
  ROUTER_UNAVAILABLE:
    "The built-in model service is unavailable. Restart Calmnova Code.",
  AGENT_RUNTIME_UNAVAILABLE:
    "The built-in coding agent is unavailable. Restart Calmnova Code.",
  UNKNOWN: "The AI request failed. Try again or choose another model.",
});

export class ProductError extends Error {
  constructor(code, options = {}) {
    super(SAFE_MESSAGES[code] || SAFE_MESSAGES.UNKNOWN);
    this.name = "ProductError";
    this.code = SAFE_MESSAGES[code] ? code : ProductErrorCode.UNKNOWN;
    this.statusCode = Number(options.statusCode) || statusForCode(this.code);
    this.providerId = safeIdentifier(options.providerId);
    this.cause = options.cause;
  }
}

export function productErrorFromUpstream(error, route = {}) {
  if (error instanceof ProductError) return error;
  const providerId = route.provider || route.providerId || route.id || "";
  if (Object.values(ProductErrorCode).includes(error?.code)) {
    return new ProductError(error.code, {
      statusCode: error.statusCode,
      providerId,
      cause: error,
    });
  }
  if (error?.code === "missing_provider_api_key") {
    return new ProductError(ProductErrorCode.PROVIDER_NOT_CONFIGURED, {
      statusCode: 400,
      providerId,
      cause: error,
    });
  }
  if (error?.code === "upstream_timeout") {
    return new ProductError(ProductErrorCode.TIMEOUT, {
      statusCode: 504,
      providerId,
      cause: error,
    });
  }
  if (error?.code === "upstream_network_error") {
    return new ProductError(ProductErrorCode.NETWORK_ERROR, {
      statusCode: 502,
      providerId,
      cause: error,
    });
  }
  if (error?.code === "invalid_upstream_response") {
    return new ProductError(ProductErrorCode.INVALID_RESPONSE, {
      statusCode: 502,
      providerId,
      cause: error,
    });
  }
  const status = Number(error?.statusCode || 0);
  const providerCode = upstreamErrorCode(error);
  let code = ProductErrorCode.UNKNOWN;
  if (
    /model.*(not.*found|unavailable|access)|model_not_found/i.test(providerCode)
  ) {
    code = ProductErrorCode.MODEL_UNAVAILABLE;
  } else if (status === 401 || status === 403)
    code = ProductErrorCode.INVALID_API_KEY;
  else if (
    status === 402 ||
    /quota|balance|billing|credit/i.test(providerCode)
  ) {
    code = ProductErrorCode.INSUFFICIENT_BALANCE;
  } else if (status === 429) code = ProductErrorCode.RATE_LIMITED;
  else if (status === 404) {
    code = ProductErrorCode.MODEL_UNAVAILABLE;
  } else if (status >= 500) code = ProductErrorCode.PROVIDER_UNAVAILABLE;
  else if (status === 400 || status === 422)
    code = ProductErrorCode.INVALID_RESPONSE;
  return new ProductError(code, {
    statusCode: status || undefined,
    providerId,
    cause: error,
  });
}

export function safeProductError(error, route = {}) {
  const productError = productErrorFromUpstream(error, route);
  return {
    code: productError.code,
    message: productError.message,
    statusCode: productError.statusCode,
    ...(productError.providerId ? { providerId: productError.providerId } : {}),
  };
}

function upstreamErrorCode(error) {
  try {
    const body = JSON.parse(String(error?.bodyText || ""));
    return String(body?.error?.code || body?.error?.type || body?.code || "");
  } catch {
    return "";
  }
}

function safeIdentifier(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 80);
}

function statusForCode(code) {
  if (code === ProductErrorCode.INVALID_API_KEY) return 401;
  if (code === ProductErrorCode.PROVIDER_NOT_CONFIGURED) return 400;
  if (
    code === ProductErrorCode.INSUFFICIENT_BALANCE ||
    code === ProductErrorCode.RATE_LIMITED
  )
    return 429;
  if (code === ProductErrorCode.MODEL_UNAVAILABLE) return 404;
  if (code === ProductErrorCode.TIMEOUT) return 504;
  return 502;
}
