/*! @license Adapted from CodexBridge (https://github.com/wangzhezbz/codex-bridge).
 * Copyright (c) 2026 wangzhezbz. Licensed under the MIT License; see the package LICENSE.
 */
import zlib from "node:zlib";

export function cloneJson(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

export function tryParseJson(text, fallback = null) {
  if (typeof text !== "string" || text.trim() === "") {
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function stringifyJson(value) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value ?? "");
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export const DEFAULT_COMPRESSED_REQUEST_LIMIT_BYTES = 25 * 1024 * 1024;
export const DEFAULT_DECOMPRESSED_REQUEST_LIMIT_BYTES = 25 * 1024 * 1024;

export async function readJsonRequest(
  req,
  limitBytes = DEFAULT_DECOMPRESSED_REQUEST_LIMIT_BYTES,
  compressedLimitBytes = DEFAULT_COMPRESSED_REQUEST_LIMIT_BYTES,
) {
  rejectOversizedContentLength(req, compressedLimitBytes);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > compressedLimitBytes) {
      throw requestTooLargeError(
        `Compressed request body exceeds ${compressedLimitBytes} bytes`,
      );
    }
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks);
  const decodedBody = decodeRequestBody(
    rawBody,
    req.headers?.["content-encoding"],
    limitBytes,
  );
  if (decodedBody.length > limitBytes) {
    throw requestTooLargeError(
      `Decompressed request body exceeds ${limitBytes} bytes`,
    );
  }

  const text = decodedBody.toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch (cause) {
    const error = new Error("Request body is not valid JSON");
    error.statusCode = 400;
    error.cause = cause;
    throw error;
  }
}

function rejectOversizedContentLength(req, compressedLimitBytes) {
  const raw = req.headers?.["content-length"];
  if (raw === undefined) {
    return;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  const length = Number(value);
  if (Number.isFinite(length) && length > compressedLimitBytes) {
    throw requestTooLargeError(
      `Content-Length exceeds ${compressedLimitBytes} bytes`,
    );
  }
}

function decodeRequestBody(body, contentEncoding = "", limitBytes) {
  const encodings = String(contentEncoding || "")
    .split(",")
    .map((encoding) => encoding.trim().toLowerCase())
    .filter(Boolean);

  let decoded = body;
  try {
    for (const encoding of encodings.reverse()) {
      if (encoding === "identity") {
        continue;
      }
      const options = { maxOutputLength: limitBytes };
      if (encoding === "gzip" || encoding === "x-gzip") {
        decoded = zlib.gunzipSync(decoded, options);
        continue;
      }
      if (encoding === "deflate") {
        decoded = zlib.inflateSync(decoded, options);
        continue;
      }
      if (encoding === "br") {
        decoded = zlib.brotliDecompressSync(decoded, options);
        continue;
      }
      if (encoding === "zstd") {
        if (typeof zlib.zstdDecompressSync !== "function") {
          const error = new Error(
            "This Node runtime cannot decode zstd request bodies",
          );
          error.statusCode = 415;
          error.code = "unsupported_content_encoding";
          throw error;
        }
        decoded = zlib.zstdDecompressSync(decoded, options);
        continue;
      }
      const error = new Error(
        `Unsupported request content-encoding: ${contentEncoding}`,
      );
      error.statusCode = 415;
      error.code = "unsupported_content_encoding";
      throw error;
    }
  } catch (cause) {
    if (cause?.statusCode) {
      throw cause;
    }
    if (isOutputLimitError(cause)) {
      throw requestTooLargeError(
        `Decompressed request body exceeds ${limitBytes} bytes`,
        cause,
      );
    }
    const error = new Error("Request body compression is malformed");
    error.statusCode = 400;
    error.code = "invalid_compressed_body";
    error.cause = cause;
    throw error;
  }
  return decoded;
}

function isOutputLimitError(error) {
  return (
    error?.code === "ERR_BUFFER_TOO_LARGE" ||
    /maxoutputlength|output length|larger than|cannot create a buffer larger/i.test(
      String(error?.message || ""),
    )
  );
}

function requestTooLargeError(message, cause) {
  const error = new Error(message);
  error.statusCode = 413;
  error.code = "request_too_large";
  if (cause) {
    error.cause = cause;
  }
  return error;
}

export function jsonResponse(res, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

export function openAiError(message, statusCode = 500, code = "router_error") {
  return {
    error: {
      message,
      type: statusCode >= 500 ? "server_error" : "invalid_request_error",
      param: null,
      code,
    },
  };
}
