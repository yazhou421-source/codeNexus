import { randomUUID } from "node:crypto";
import { ProductError, ProductErrorCode } from "./product-errors.js";
import { responseToolCallFromChat } from "./tools.js";

export async function streamChatCompletionToResponses(
  upstream,
  res,
  { requestBody, route, converted, context = {} },
) {
  if (!upstream.body) {
    throw new ProductError(ProductErrorCode.INVALID_RESPONSE, {
      providerId: providerId(route),
    });
  }

  const startedAt = Number(context.startedAt || Date.now());
  const headersAt = Date.now();
  const responseId = `resp_${randomUUID()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const output = [];
  const toolCalls = new Map();
  let textState = null;
  let usage;
  let sawDone = false;
  let sawFinish = false;
  let firstUpstreamDeltaAt = 0;
  let firstDownstreamDeltaAt = 0;

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const inProgress = responseObject(
    responseId,
    requestBody.model || route.id,
    createdAt,
    "in_progress",
    [],
  );
  const write = (event, payload) =>
    writeSse(res, event, payload, context.clientSignal);

  const ensureText = async () => {
    if (textState) return textState;
    const outputIndex = output.length;
    const itemId = `msg_${randomUUID()}`;
    textState = { outputIndex, itemId, text: "" };
    output.push(null);
    await write("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: {
        id: itemId,
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [],
      },
    });
    await write("response.content_part.added", {
      type: "response.content_part.added",
      item_id: itemId,
      output_index: outputIndex,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
    return textState;
  };

  const ensureTool = (index, raw) => {
    let state = toolCalls.get(index);
    if (!state) {
      state = {
        index,
        itemId: `fc_${randomUUID()}`,
        callId: "",
        name: "",
        arguments: "",
        outputIndex: -1,
        added: false,
      };
      toolCalls.set(index, state);
    }
    if (!state.added && typeof raw?.id === "string" && raw.id) {
      state.callId = raw.id;
    }
    if (typeof raw?.function?.name === "string" && raw.function.name) {
      state.name += raw.function.name;
    }
    return state;
  };

  const addToolIfReady = async (state, force = false) => {
    if (state.added || !state.name || (!state.callId && !force)) return;
    state.added = true;
    state.callId ||= `call_${randomUUID()}`;
    state.outputIndex = output.length;
    const item = responseToolItem(state, converted.toolContext, "in_progress");
    output.push(null);
    await write("response.output_item.added", {
      type: "response.output_item.added",
      output_index: state.outputIndex,
      item,
    });
  };

  const processData = async (data) => {
    if (!data) return;
    if (data === "[DONE]") {
      sawDone = true;
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new ProductError(ProductErrorCode.INVALID_RESPONSE, {
        providerId: providerId(route),
      });
    }
    if (parsed?.usage && typeof parsed.usage === "object")
      usage = mapUsage(parsed.usage);
    const choices = Array.isArray(parsed?.choices) ? parsed.choices : [];
    for (const choice of choices) {
      if (choice?.finish_reason) sawFinish = true;
      if (Number(choice?.index || 0) !== 0) continue;
      const delta = choice?.delta;
      if (!delta || typeof delta !== "object") continue;
      const content = typeof delta.content === "string" ? delta.content : "";
      if (content) {
        firstUpstreamDeltaAt ||= Date.now();
        const text = await ensureText();
        text.text += content;
        await write("response.output_text.delta", {
          type: "response.output_text.delta",
          item_id: text.itemId,
          output_index: text.outputIndex,
          content_index: 0,
          delta: content,
        });
        firstDownstreamDeltaAt ||= Date.now();
      }
      for (const [fallbackIndex, value] of (delta.tool_calls || []).entries()) {
        if (!value || typeof value !== "object") continue;
        const numericIndex = Number(value.index);
        const state = ensureTool(
          Number.isFinite(numericIndex)
            ? Math.floor(numericIndex)
            : fallbackIndex,
          value,
        );
        await addToolIfReady(state);
        const argumentDelta =
          typeof value.function?.arguments === "string"
            ? value.function.arguments
            : "";
        if (!argumentDelta) continue;
        firstUpstreamDeltaAt ||= Date.now();
        state.arguments += argumentDelta;
        await addToolIfReady(state);
        if (state.added) {
          await writeToolDelta(
            write,
            state,
            converted.toolContext,
            argumentDelta,
          );
          firstDownstreamDeltaAt ||= Date.now();
        }
      }
    }
  };

  try {
    await write("response.created", {
      type: "response.created",
      response: inProgress,
    });
    await write("response.in_progress", {
      type: "response.in_progress",
      response: inProgress,
    });
    await consumeSse(upstream.body, processData, {
      signal: context.clientSignal,
      timeoutMs: streamTimeoutMs(route),
    });
    if (!sawDone && !sawFinish) {
      throw new ProductError(ProductErrorCode.STREAM_INTERRUPTED, {
        providerId: providerId(route),
      });
    }
    if (textState) await finishText(write, textState, output);
    for (const state of [...toolCalls.values()].sort(
      (left, right) => left.outputIndex - right.outputIndex,
    )) {
      await addToolIfReady(state, true);
      if (!state.added) {
        throw new ProductError(ProductErrorCode.INVALID_RESPONSE, {
          providerId: providerId(route),
        });
      }
      await finishTool(write, state, converted.toolContext, output);
    }
    const response = responseObject(
      responseId,
      requestBody.model || route.id,
      createdAt,
      "completed",
      output,
      usage,
    );
    await write("response.completed", {
      type: "response.completed",
      response,
    });
    res.end("data: [DONE]\n\n");
    logStreamMetrics(context, route, {
      startedAt,
      headersAt,
      firstUpstreamDeltaAt,
      firstDownstreamDeltaAt,
      completedAt: Date.now(),
    });
    return {
      response,
      chat: {
        id: responseId,
        choices: [
          {
            message: {
              role: "assistant",
              content: textState?.text || null,
              ...(toolCalls.size
                ? {
                    tool_calls: [...toolCalls.values()].map((state) => ({
                      id: state.callId,
                      type: "function",
                      function: {
                        name: state.name,
                        arguments: state.arguments,
                      },
                    })),
                  }
                : {}),
            },
          },
        ],
        usage,
      },
    };
  } catch (error) {
    await upstream.body.cancel().catch(() => undefined);
    if (context.clientSignal?.aborted) throw error;
    if (!res.destroyed && !res.writableEnded) {
      const failure =
        error instanceof ProductError
          ? error
          : new ProductError(ProductErrorCode.STREAM_INTERRUPTED, {
              providerId: providerId(route),
              cause: error,
            });
      const failed = responseObject(
        responseId,
        requestBody.model || route.id,
        createdAt,
        "failed",
        output.filter(Boolean),
      );
      failed.error = { code: failure.code, message: failure.message };
      await write("response.failed", {
        type: "response.failed",
        response: failed,
      });
      res.end("data: [DONE]\n\n");
      throw failure;
    }
    throw error;
  }
}

export async function consumeSse(body, onData, options = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let timeout;
  let timedOut = false;
  let finished = false;
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", cancelReader, { once: true });
  const consume = async () => {
    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
      options.signal?.throwIfAborted();
      const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)[0];
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + separator.length);
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) await onData(data);
    }
    if (buffer.length > 8_000_000)
      throw new ProductError(ProductErrorCode.INVALID_RESPONSE);
  };
  try {
    while (!finished) {
      options.signal?.throwIfAborted();
      if (options.timeoutMs)
        timeout = setTimeout(() => {
          timedOut = true;
          cancelReader();
        }, options.timeoutMs);
      const { done, value } = await reader.read();
      clearTimeout(timeout);
      if (timedOut) throw new ProductError(ProductErrorCode.TIMEOUT);
      options.signal?.throwIfAborted();
      if (done) {
        finished = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      await consume();
    }
    buffer += decoder.decode() + "\n\n";
    await consume();
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancelReader);
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function consumeSseBuffer(buffer, onData) {
  let boundary;
  while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
    const block = buffer.slice(0, boundary);
    const separator =
      buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || "\n\n";
    buffer = buffer.slice(boundary + separator.length);
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) onData(data);
  }
  return buffer;
}

async function finishText(write, state, output) {
  const part = { type: "output_text", text: state.text, annotations: [] };
  await write("response.output_text.done", {
    type: "response.output_text.done",
    item_id: state.itemId,
    output_index: state.outputIndex,
    content_index: 0,
    text: state.text,
  });
  await write("response.content_part.done", {
    type: "response.content_part.done",
    item_id: state.itemId,
    output_index: state.outputIndex,
    content_index: 0,
    part,
  });
  const item = {
    id: state.itemId,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [part],
  };
  output[state.outputIndex] = item;
  await write("response.output_item.done", {
    type: "response.output_item.done",
    output_index: state.outputIndex,
    item,
  });
}

function responseToolItem(state, toolContext, status) {
  const item = responseToolCallFromChat(
    {
      id: state.callId,
      type: "function",
      function: { name: state.name, arguments: state.arguments },
    },
    toolContext,
  );
  item.id = state.itemId;
  item.status = status;
  if (status === "in_progress") {
    if (item.type === "custom_tool_call") item.input = "";
    else if (item.type === "function_call") item.arguments = "";
  }
  return item;
}

async function writeToolDelta(write, state, toolContext, delta) {
  const item = responseToolItem(state, toolContext, "in_progress");
  if (item.type === "custom_tool_call") {
    await write("response.custom_tool_call_input.delta", {
      type: "response.custom_tool_call_input.delta",
      item_id: state.itemId,
      output_index: state.outputIndex,
      delta,
    });
  } else if (item.type === "function_call") {
    await write("response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      item_id: state.itemId,
      output_index: state.outputIndex,
      delta,
    });
  }
}

async function finishTool(write, state, toolContext, output) {
  const item = responseToolItem(state, toolContext, "completed");
  output[state.outputIndex] = item;
  if (item.type === "custom_tool_call") {
    await write("response.custom_tool_call_input.done", {
      type: "response.custom_tool_call_input.done",
      item_id: state.itemId,
      output_index: state.outputIndex,
      input: item.input,
    });
  } else if (item.type === "function_call") {
    await write("response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      item_id: state.itemId,
      output_index: state.outputIndex,
      arguments: item.arguments,
    });
  }
  await write("response.output_item.done", {
    type: "response.output_item.done",
    output_index: state.outputIndex,
    item,
  });
}

function responseObject(id, model, createdAt, status, output, usage) {
  return {
    id,
    object: "response",
    created_at: createdAt,
    status,
    model,
    output,
    output_text: output
      .filter((item) => item?.type === "message")
      .flatMap((item) => item.content || [])
      .map((part) => part.text || "")
      .join(""),
    parallel_tool_calls: true,
    error: null,
    incomplete_details: null,
    usage: usage || mapUsage(),
  };
}

function mapUsage(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const inputTokens = Number(value.prompt_tokens || value.input_tokens || 0);
  const outputTokens = Number(
    value.completion_tokens || value.output_tokens || 0,
  );
  return {
    input_tokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    total_tokens: Number(value.total_tokens) || inputTokens + outputTokens || 0,
    input_tokens_details: {
      cached_tokens: Number(
        value.prompt_tokens_details?.cached_tokens ??
          value.input_tokens_details?.cached_tokens ??
          value.prompt_cache_hit_tokens ??
          0,
      ),
    },
    output_tokens_details: {
      reasoning_tokens: Number(
        value.completion_tokens_details?.reasoning_tokens ??
          value.output_tokens_details?.reasoning_tokens ??
          0,
      ),
    },
  };
}

function streamTimeoutMs(route) {
  const value = Number(
    route.streamTimeoutMs || route.upstreamTimeoutMs || 300_000,
  );
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 300_000;
}

function providerId(route) {
  return route.provider || route.providerId || route.id || "";
}

export async function writeSse(res, event, payload, signal) {
  signal?.throwIfAborted();
  if (res.destroyed || res.writableEnded)
    throw new ProductError(ProductErrorCode.STREAM_INTERRUPTED);
  if (res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`))
    return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", drained);
      res.off("close", closed);
      res.off("error", closed);
      signal?.removeEventListener("abort", closed);
    };
    const drained = () => {
      cleanup();
      resolve();
    };
    const closed = () => {
      cleanup();
      reject(new ProductError(ProductErrorCode.STREAM_INTERRUPTED));
    };
    res.once("drain", drained);
    res.once("close", closed);
    res.once("error", closed);
    signal?.addEventListener("abort", closed, { once: true });
    if (signal?.aborted || res.destroyed || res.writableEnded) closed();
    else if (!res.writableNeedDrain) drained();
  });
}

function logStreamMetrics(context, route, times) {
  const elapsed = (at) => (at ? Math.max(0, at - times.startedAt) : -1);
  console.log(
    `[${new Date().toISOString()}] ${context.requestId || "req"} ` +
      `stream route=${route.id || "-"} ttfb_ms=${elapsed(times.headersAt)} ` +
      `first_upstream_delta_ms=${elapsed(times.firstUpstreamDeltaAt)} ` +
      `first_downstream_delta_ms=${elapsed(times.firstDownstreamDeltaAt)} ` +
      `complete_ms=${elapsed(times.completedAt)}`,
  );
}
