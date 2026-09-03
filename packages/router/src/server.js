/*! @license Adapted from CodexBridge (https://github.com/wangzhezbz/codex-bridge).
 * Copyright (c) 2026 wangzhezbz. Licensed under the MIT License; see the package LICENSE.
 */
import http from "node:http";
import {
  authModeForRoute,
  loadConfig,
  routeForModel,
  secretValuesForConfig,
} from "./config.js";
import { ResponseHistory } from "./history.js";
import {
  DEFAULT_COMPRESSED_REQUEST_LIMIT_BYTES,
  DEFAULT_DECOMPRESSED_REQUEST_LIMIT_BYTES,
  jsonResponse,
  openAiError,
  readJsonRequest,
} from "./json.js";
import { buildModelCatalog, openAiModelsList } from "./model-catalog.js";
import { redactSensitiveText } from "./redaction.js";
import {
  handleResponsesRequest,
  sendUpstreamError,
  upstreamErrorLogPreview,
} from "./upstream.js";

export const ROUTER_SERVICE_ID = "codenexus-embedded-router";
export const ROUTER_PROTOCOL_VERSION = 1;

export function createRouterServer(config = loadConfig()) {
  const history = new ResponseHistory();

  return http.createServer(async (req, res) => {
    let activeConfig = config;
    let knownSecrets = secretValuesForConfig(config);
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const codexAuthRequest = isCodexAuthPath(url.pathname);
      const pathname = normalizedApiPath(url.pathname);
      activeConfig = currentConfig(config);
      knownSecrets = secretValuesForConfig(activeConfig);
      logAccess(req, url, knownSecrets);

      if (req.method === "OPTIONS") {
        writeOptionsDisabled(res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        jsonResponse(res, 200, {
          ok: true,
          service: ROUTER_SERVICE_ID,
          protocolVersion: ROUTER_PROTOCOL_VERSION,
        });
        return;
      }

      if (
        req.method === "GET" &&
        ["/v1/models", "/models"].includes(pathname)
      ) {
        jsonResponse(res, 200, openAiModelsList(activeConfig));
        return;
      }

      if (
        req.method === "GET" &&
        ["/model-catalog.json", "/v1/model-catalog.json"].includes(pathname)
      ) {
        jsonResponse(res, 200, buildModelCatalog(activeConfig));
        return;
      }

      if (req.method === "GET" && isResponsesCollection(pathname)) {
        jsonResponse(res, 200, {
          object: "list",
          data: [],
          has_more: false,
        });
        return;
      }

      const responseItemId = responseIdFromItemPath(pathname);
      if (req.method === "GET" && responseItemId) {
        jsonResponse(
          res,
          200,
          history.getResponse(responseItemId) ||
            placeholderResponse(responseItemId, activeConfig.defaultModel),
        );
        return;
      }

      const responseCancelId = responseIdFromCancelPath(pathname);
      if (req.method === "POST" && responseCancelId) {
        jsonResponse(
          res,
          200,
          placeholderResponse(
            responseCancelId,
            activeConfig.defaultModel,
            "cancelled",
          ),
        );
        return;
      }

      if (
        ["PATCH", "PUT"].includes(req.method || "") &&
        isModelSettingsPath(pathname)
      ) {
        const body = await readJsonRequest(req);
        jsonResponse(res, 200, {
          ok: true,
          object: "codexbridge.model_settings",
          model: body.model || activeConfig.defaultModel || null,
          model_reasoning_effort:
            body.model_reasoning_effort || body.reasoning_effort || null,
        });
        return;
      }

      if (
        req.method === "POST" &&
        ["/v1/responses", "/responses"].includes(pathname)
      ) {
        const clientAuth = authorizeClient(req, activeConfig, {
          allowCodexBearer: codexAuthRequest,
        });
        if (!clientAuth.ok) {
          res.once("finish", () => req.destroy());
          jsonResponse(
            res,
            401,
            openAiError(
              "CodeNexus Embedded Router token mismatch. Check the configured local Router credentials and retry.",
              401,
              "invalid_router_token",
            ),
            { connection: "close" },
          );
          return;
        }
        const limits = requestLimits(activeConfig);
        const body = await readJsonRequest(
          req,
          limits.decompressedBytes,
          limits.compressedBytes,
        );
        const route = routeForModel(activeConfig, body.model);
        if (codexAuthRequest && authModeForRoute(route) !== "codex_openai") {
          jsonResponse(
            res,
            403,
            openAiError(
              "The Codex-auth Router endpoint cannot access API-key routes.",
              403,
              "codex_auth_route_forbidden",
            ),
          );
          return;
        }
        const requestId = makeRequestId();
        const clientAbort = clientAbortContext(req, res);
        console.log(
          redactSensitiveText(
            `[${new Date().toISOString()}] ${requestId} <- /v1/responses ` +
              `model=${body.model || "(default)"} route=${route.id} ` +
              `api=${route.api} upstream_model=${route.model} stream=${Boolean(body.stream)} ` +
              `previous_response_id=${body.previous_response_id || "-"} ` +
              `client_auth=${clientAuth.kind} upstream_auth=${authModeForRoute(route)}`,
            knownSecrets,
          ),
        );
        try {
          await handleResponsesRequest(body, route, history, res, {
            requestId,
            clientAuth,
            clientHeaders: req.headers,
            clientSignal: clientAbort.signal,
            knownSecrets,
          });
        } catch (error) {
          if (error?.code === "client_closed_request") {
            console.warn(
              `[${new Date().toISOString()}] ${requestId} !! client closed request before upstream completed`,
            );
            return;
          }
          console.error(
            requestErrorLine(requestId, route, error, knownSecrets),
          );
          if (!res.destroyed && !res.writableEnded) {
            sendUpstreamError(res, error, knownSecrets);
          }
        } finally {
          clientAbort.cleanup();
        }
        return;
      }

      jsonResponse(
        res,
        404,
        openAiError(`No route for ${req.method} ${url.pathname}`, 404),
      );
    } catch (error) {
      console.error(
        redactSensitiveText(
          `[${new Date().toISOString()}] router error: ${error.stack || error.message}`,
          knownSecrets,
        ),
      );
      if (!res.destroyed && !res.writableEnded) {
        sendUpstreamError(res, error, knownSecrets);
      }
    }
  });
}

export function startServer(config = loadConfig()) {
  const server = createRouterServer(config);
  const host = config.host || "127.0.0.1";
  const port = Number(config.port || 15722);
  const knownSecrets = secretValuesForConfig(config);
  server.listen(port, host, () => {
    console.log(
      `codenexus embedded router listening on http://${host}:${port}`,
    );
    console.log(`config source: ${config.__path ? "file" : "inline"}`);
    console.log(
      redactSensitiveText(
        `models: ${config.models.map((model) => model.id).join(", ")}`,
        knownSecrets,
      ),
    );
  });
  return server;
}

function logAccess(req, url, knownSecrets = []) {
  console.log(
    redactSensitiveText(
      `[${new Date().toISOString()}] access ${req.method || "GET"} ${url.pathname}`,
      knownSecrets,
    ),
  );
}

function authorizeClient(req, config, options = {}) {
  const bearerToken = bearerTokenFromHeader(req.headers.authorization);
  if (!config.authToken) {
    if (bearerToken) {
      return { ok: true, kind: "codex_openai", bearerToken };
    }
    return { ok: true, kind: "none" };
  }
  if (bearerToken && bearerToken === config.authToken) {
    return { ok: true, kind: "local", bearerToken };
  }
  if (
    bearerToken &&
    (options.allowCodexBearer || config.clientAuth?.allowOpenAiBearer === true)
  ) {
    return { ok: true, kind: "codex_openai", bearerToken };
  }
  return { ok: false, kind: "invalid" };
}

function isCodexAuthPath(pathname) {
  return pathname === "/codex-auth" || pathname.startsWith("/codex-auth/");
}

function normalizedApiPath(pathname) {
  if (!isCodexAuthPath(pathname)) return pathname;
  const normalized = pathname.slice("/codex-auth".length);
  return normalized || "/";
}

function requestLimits(config) {
  return {
    compressedBytes: positiveByteLimit(
      config.requestLimits?.compressedBytes,
      DEFAULT_COMPRESSED_REQUEST_LIMIT_BYTES,
    ),
    decompressedBytes: positiveByteLimit(
      config.requestLimits?.decompressedBytes,
      DEFAULT_DECOMPRESSED_REQUEST_LIMIT_BYTES,
    ),
  };
}

function positiveByteLimit(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function currentConfig(config) {
  if (!config.__path) {
    return config;
  }
  return loadConfig(config.__path);
}

function bearerTokenFromHeader(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function clientAbortContext(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableEnded && !controller.signal.aborted) {
      controller.abort(new Error("client connection closed"));
    }
  };
  req.once("aborted", abort);
  res.once("close", abort);
  return {
    signal: controller.signal,
    cleanup() {
      req.off("aborted", abort);
      res.off("close", abort);
    },
  };
}

function writeOptionsDisabled(res) {
  res.writeHead(204, { allow: "GET,POST,PATCH,PUT" });
  res.end();
}

function isResponsesCollection(pathname) {
  return ["/v1/responses", "/responses"].includes(pathname);
}

function isModelSettingsPath(pathname) {
  if (isResponsesCollection(pathname)) {
    return true;
  }
  return /^\/(?:v1\/)?responses\/[^/]+(?:\/model_settings)?$/.test(pathname);
}

function responseIdFromItemPath(pathname) {
  const match = pathname.match(/^\/(?:v1\/)?responses\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function responseIdFromCancelPath(pathname) {
  const match = pathname.match(/^\/(?:v1\/)?responses\/([^/]+)\/cancel$/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function placeholderResponse(id, model, status = "completed") {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model: model || null,
    output: [],
    output_text: "",
    parallel_tool_calls: true,
    error: null,
    incomplete_details: null,
    usage: null,
  };
}

function makeRequestId() {
  return `req_${Math.random().toString(36).slice(2, 10)}`;
}

function requestErrorLine(requestId, route, error, knownSecrets = []) {
  const status = error?.statusCode || 599;
  const cause = error?.cause?.code || error?.cause?.message || "";
  return redactSensitiveText(
    `[${new Date().toISOString()}] ${requestId} !! upstream ` +
      `route=${route.id} status=${status} error=${safeLogValue(error?.message || String(error))}` +
      (cause ? ` cause=${safeLogValue(cause)}` : "") +
      upstreamErrorLogPreview(error, knownSecrets),
    knownSecrets,
  );
}

function safeLogValue(value) {
  return String(value || "")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}
