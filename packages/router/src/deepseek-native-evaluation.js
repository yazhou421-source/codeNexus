// Opt-in 3.2C1 evaluation adapter. Production routes never import/select it.
import { consumeSse, writeSse } from "./chat-stream-to-responses.js";
import { callStreamingUpstream } from "./upstream.js";
import { ProductError, safeProductError } from "./product-errors.js";

const supportedFields = new Set([
  "model",
  "input",
  "instructions",
  "stream",
  "temperature",
  "top_p",
  "max_output_tokens",
  "top_logprobs",
  "tools",
  "tool_choice",
  "reasoning",
  "text",
  "parallel_tool_calls",
]);

export function adaptDeepSeekResponsesRequest(request, route, history) {
  const payload = Object.fromEntries(
    Object.entries(request).filter(([key]) => supportedFields.has(key)),
  );
  payload.model = route.model;
  payload.store = false;
  payload.stream = true;
  if (request.previous_response_id) {
    const previous = history?.getResponseMeta(
      request.previous_response_id,
    )?.nativeInput;
    if (!previous) throw new ProductError("INVALID_RESPONSE");
    payload.input = [...previous, ...asInput(request.input)];
  }
  return payload;
}

function asInput(input) {
  return Array.isArray(input)
    ? input
    : typeof input === "string"
      ? [{ role: "user", content: input }]
      : [];
}

export function sanitizeDeepSeekNativeEvent(event, reasoningItems = new Set()) {
  if (event.type?.includes("reasoning")) return null;
  if (event.item?.type === "reasoning") {
    reasoningItems.add(event.item.id);
    return null;
  }
  if (
    reasoningItems.has(event.item_id) ||
    event.part?.type === "reasoning_text"
  )
    return null;
  if (event.response) {
    const response = {
      ...event.response,
      output: (event.response.output || []).filter(
        (item) => item.type !== "reasoning",
      ),
    };
    if (response.error) {
      const safe = safeProductError(
        {
          bodyText: JSON.stringify({ error: response.error }),
          statusCode: 502,
        },
        { provider: "deepseek" },
      );
      response.error = { code: safe.code, message: safe.message };
    }
    return { ...event, response };
  }
  if (event.type === "error") {
    const safe = safeProductError(
      { bodyText: JSON.stringify({ error: event }), statusCode: 502 },
      { provider: "deepseek" },
    );
    return { type: "error", code: safe.code, message: safe.message };
  }
  return event;
}

export async function proxyDeepSeekNativeEvaluation(
  request,
  route,
  history,
  res,
  context,
) {
  const payload = adaptDeepSeekResponsesRequest(request, route, history);
  const startedAt = context.startedAt || Date.now();
  const upstream = await callStreamingUpstream(
    "https://api.deepseek.com/v1/responses",
    route,
    payload,
    context,
    { cacheFailures: false, timeoutMs: 30_000 },
  );
  const headersAt = Date.now();
  let firstDelta = 0;
  let complete;
  let reasoningCharacters = 0;
  const reasoningItems = new Set();
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
  });
  try {
    await consumeSse(
      upstream.body,
      async (data) => {
        if (data === "[DONE]") return;
        let raw;
        try {
          raw = JSON.parse(data);
        } catch {
          throw new ProductError("INVALID_RESPONSE");
        }
        if (raw.type === "response.reasoning_text.delta")
          reasoningCharacters +=
            typeof raw.delta === "string" ? raw.delta.length : 0;
        const event = sanitizeDeepSeekNativeEvent(raw, reasoningItems);
        if (!event) return;
        if (
          event.type === "response.output_text.delta" ||
          event.type === "response.function_call_arguments.delta" ||
          event.type === "response.custom_tool_call_input.delta"
        )
          firstDelta ||= Date.now();
        await writeSse(res, event.type, event, context.clientSignal);
        if (
          [
            "response.completed",
            "response.incomplete",
            "response.failed",
          ].includes(event.type)
        )
          complete = event.response;
      },
      { signal: context.clientSignal, timeoutMs: 30_000 },
    );
    if (!complete) throw new ProductError("STREAM_INTERRUPTED");
    // DeepSeek is stateless; retain the bounded test conversation locally.
    history.recordResponse(complete, {
      upstreamKnown: false,
      nativeInput: [...asInput(payload.input), ...(complete.output || [])],
    });
    res.end();
    console.log(
      `[native-evaluation] stream route=${route.id} ttfb_ms=${headersAt - startedAt} first_upstream_delta_ms=${firstDelta ? firstDelta - startedAt : -1} first_downstream_delta_ms=${firstDelta ? firstDelta - startedAt : -1} complete_ms=${Date.now() - startedAt} reasoning_characters=${reasoningCharacters}`,
    );
    const u = complete.usage;
    if (u)
      console.log(
        `[native-evaluation] usage prompt=${u.input_tokens} completion=${u.output_tokens} total=${u.total_tokens}`,
      );
  } catch (error) {
    await upstream.body?.cancel().catch(() => undefined);
    if (
      !res.destroyed &&
      !res.writableEnded &&
      !context.clientSignal?.aborted
    ) {
      const safe = safeProductError(error, route);
      await writeSse(
        res,
        "response.failed",
        {
          type: "response.failed",
          response: {
            status: "failed",
            error: { code: safe.code, message: safe.message },
          },
        },
        context.clientSignal,
      );
      res.end();
    }
    throw error;
  }
}
