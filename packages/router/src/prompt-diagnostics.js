import { createHash } from "node:crypto";
import { cloneJson, stringifyJson } from "./json.js";
import { isResponseToolCallItem, isResponseToolOutputItem } from "./tools.js";

export const PROMPT_CATEGORIES = [
  "system_instructions",
  "developer_instructions",
  "codex_built_in_instructions",
  "collaboration_mode_instructions",
  "user_messages",
  "assistant_history",
  "tool_results_history",
  "shell_command_output",
  "file_diff_content",
  "workspace_context_injections",
  "project_instructions",
  "skills_instructions",
  "mcp_related_context",
  "tool_function_schemas",
  "mcp_tool_schemas",
  "image_tool_capability_metadata",
  "model_capability_catalog_metadata",
  "router_compatibility_instructions",
  "responses_to_chat_boilerplate",
  "previous_response_history_reconstruction",
  "other",
];

const TAGGED_CATEGORIES = [
  [
    /<skills_instructions>[\s\S]*?<\/skills_instructions>/gi,
    "skills_instructions",
  ],
  [
    /<permissions instructions>[\s\S]*?<\/permissions instructions>/gi,
    "developer_instructions",
  ],
  [
    /<environment_context>[\s\S]*?<\/environment_context>/gi,
    "workspace_context_injections",
  ],
  [/<mcp(?:_|\s)[^>]*>[\s\S]*?<\/mcp(?:_|\s)[^>]*>/gi, "mcp_related_context"],
];
const COLLABORATION_PATTERN =
  /<collaboration_mode>([\s\S]*?)<\/collaboration_mode>/gi;
const PROJECT_INSTRUCTIONS_PATTERN =
  /(?:^|\n)# AGENTS\.md instructions[^\n]*(?:\n[\s\S]*)?/i;
const MCP_GUIDANCE_PATTERN =
  /CodexBridge tool guidance: MCP namespace tools are exposed as flattened function names\. Only call tools that are present in this request's tools list\. If an MCP tool call returns unsupported call, do not retry that same tool repeatedly; use another available tool or explain the limitation\.?\s*/g;
const TEXT_SPLITTABLE_CATEGORIES = new Set([
  "system_instructions",
  "developer_instructions",
  "codex_built_in_instructions",
  "user_messages",
]);

export function estimatePromptTokens(value) {
  return Math.ceil(measurePromptValue(value).utf8Bytes / 4);
}

export function measurePromptValue(value) {
  const text = typeof value === "string" ? value : stringifyJson(value ?? null);
  const utf8Bytes = Buffer.byteLength(text, "utf8");
  return {
    characters: text.length,
    utf8Bytes,
    estimatedTokens: Math.ceil(utf8Bytes / 4),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

export function analyzePromptPayload(payload, { phase = "unknown" } = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  const total = measurePromptValue(body);
  const items = [];
  const toolCallNames = toolCallNamesById(body);

  if (typeof body.instructions === "string" && body.instructions) {
    addTextFragments(items, body.instructions, {
      role: "system",
      type: "instructions",
      fallbackCategory: "codex_built_in_instructions",
    });
  }

  for (const message of promptMessages(body)) {
    addMessage(items, message, toolCallNames);
  }

  for (const tool of Array.isArray(body.tools) ? body.tools : []) {
    const name = promptToolName(tool);
    addItem(items, toolCategory(name), tool, {
      type: "tool_schema",
      name,
    });
  }

  const metadata = Object.fromEntries(
    Object.entries(body).filter(
      ([key]) => !["instructions", "input", "messages", "tools"].includes(key),
    ),
  );
  if (Object.keys(metadata).length > 0) {
    addItem(items, "model_capability_catalog_metadata", metadata, {
      type: "request_metadata",
    });
  }

  if (body.previous_response_id && hasExpandedHistory(body)) {
    addItem(
      items,
      "previous_response_history_reconstruction",
      String(body.previous_response_id),
      {
        type: "previous_response_with_expanded_history",
      },
    );
  }

  const accountedCharacters = items.reduce(
    (sum, item) => sum + item.characters,
    0,
  );
  const accountedBytes = items.reduce((sum, item) => sum + item.utf8Bytes, 0);
  addMeasuredItem(
    items,
    "responses_to_chat_boilerplate",
    {
      characters: Math.max(0, total.characters - accountedCharacters),
      utf8Bytes: Math.max(0, total.utf8Bytes - accountedBytes),
    },
    { type: "json_structure_and_escaping" },
  );

  const breakdown = PROMPT_CATEGORIES.map((category) => {
    const matches = items.filter((item) => item.category === category);
    const characters = matches.reduce((sum, item) => sum + item.characters, 0);
    const utf8Bytes = matches.reduce((sum, item) => sum + item.utf8Bytes, 0);
    return {
      category,
      itemCount: matches.length,
      characters,
      utf8Bytes,
      estimatedTokens: Math.ceil(utf8Bytes / 4),
      percentage:
        total.utf8Bytes === 0
          ? 0
          : Number(((utf8Bytes / total.utf8Bytes) * 100).toFixed(2)),
    };
  });

  return {
    phase,
    estimate: "UTF-8 bytes / 4; not a provider tokenizer count",
    total,
    breakdown,
    tools: toolSchemaReport(body),
    duplicates: detectPromptDuplicates(body),
    items: items.map(
      ({
        category,
        type,
        role,
        name,
        characters,
        utf8Bytes,
        estimatedTokens,
        sha256,
      }) => ({
        category,
        type,
        ...(role ? { role } : {}),
        ...(name ? { name } : {}),
        characters,
        utf8Bytes,
        estimatedTokens,
        sha256,
      }),
    ),
  };
}

export function analyzePromptPair(responsesPayload, chatPayload) {
  const responses = analyzePromptPayload(responsesPayload, {
    phase: "responses",
  });
  const chat = analyzePromptPayload(chatPayload, { phase: "chat_completions" });
  return {
    responses,
    chat,
    conversionDelta: metricDelta(responses.total, chat.total),
    toggles: buildPromptToggleMeasurements(chatPayload),
  };
}

export function buildPromptToggleMeasurements(payload) {
  const variants = [
    ["full", payload],
    ["mcp_disabled", withoutMcp(payload)],
    ["skills_disabled", withoutTaggedText(payload, "skills_instructions")],
    [
      "mcp_and_skills_disabled",
      withoutTaggedText(withoutMcp(payload), "skills_instructions"),
    ],
    ["minimal_tool_set", withMinimalTools(payload)],
    ["no_project_instructions", withoutProjectInstructions(payload)],
    ["no_history", withoutHistory(payload)],
  ];
  const full = measurePromptValue(payload);
  return variants.map(([name, variant]) => {
    const metric = measurePromptValue(variant);
    return { name, ...metric, deltaFromFull: metricDelta(full, metric) };
  });
}

export function detectPromptDuplicates(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const instructionValues = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    instructionValues.push({
      source: "instructions",
      value: body.instructions.trim(),
    });
  }
  for (const [index, message] of promptMessages(body).entries()) {
    const role = String(message?.role || "");
    if (!["system", "developer"].includes(role)) continue;
    for (const text of contentTexts(message?.content ?? message?.text)) {
      instructionValues.push(
        ...instructionSegments(text).map((value) => ({
          source: `${role}:${index}`,
          value,
        })),
      );
    }
  }

  const tools = Array.isArray(body.tools) ? body.tools : [];
  const toolNames = tools.map(promptToolName).filter(Boolean);
  const messages = promptMessages(body);
  const historyValues = messages
    .filter(
      (message) =>
        !["system", "developer"].includes(String(message?.role || "")),
    )
    .map((message, index) => ({
      source: `message:${index}`,
      value: stringifyJson(message),
    }));
  const toolResults = messages
    .filter(
      (message) =>
        message?.role === "tool" || isResponseToolOutputItem(message),
    )
    .map((message, index) => ({
      source: `tool_result:${index}`,
      value: `${message?.tool_call_id || message?.call_id || message?.id || ""}:${stringifyJson(message?.content ?? message?.output ?? message)}`,
    }));

  return {
    systemInstructions: duplicateGroups(instructionValues),
    toolsByName: duplicateStrings(toolNames),
    toolsBySchema: duplicateGroups(
      tools.map((tool, index) => ({
        source: `tool:${index}`,
        value: stringifyJson(tool),
      })),
    ),
    history: duplicateGroups(historyValues),
    toolResults: duplicateGroups(toolResults),
    previousResponseWithExpandedHistory: Boolean(
      body.previous_response_id && hasExpandedHistory(body),
    ),
  };
}

export function diagnosticReportContainsSensitiveValue(
  report,
  sensitiveValues,
) {
  const serialized = stringifyJson(report);
  return (sensitiveValues || []).some(
    (value) => value && serialized.includes(String(value)),
  );
}

function addMessage(items, message, toolCallNames) {
  if (!message || typeof message !== "object") return;
  const role = String(message.role || "");
  if (isResponseToolCallItem(message)) {
    addItem(items, "assistant_history", message, {
      role: "assistant",
      type: message.type || "tool_call",
    });
    return;
  }
  if (message.role === "tool" || isResponseToolOutputItem(message)) {
    const callId = message.tool_call_id || message.call_id || message.id || "";
    const toolName = toolCallNames.get(callId) || "";
    const category = /apply_patch|read_file|write_file|diff/i.test(toolName)
      ? "file_diff_content"
      : /exec|shell|command|stdin/i.test(toolName)
        ? "shell_command_output"
        : "tool_results_history";
    addItem(items, category, message, {
      role: "tool",
      type: message.type || "tool_result",
      name: toolName,
    });
    return;
  }
  const texts = contentTexts(
    message.content ?? message.text ?? message.output ?? "",
  );
  if (["system", "developer"].includes(role)) {
    for (const text of texts) {
      addTextFragments(items, text, {
        role,
        type: "message_text",
        fallbackCategory:
          role === "system" ? "system_instructions" : "developer_instructions",
      });
    }
    return;
  }
  const category =
    role === "assistant"
      ? "assistant_history"
      : role === "user"
        ? "user_messages"
        : "other";
  if (
    role === "assistant" &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0
  ) {
    addItem(items, "assistant_history", message.tool_calls, {
      role,
      type: "tool_calls",
    });
  }
  for (const text of texts) {
    if (/<environment_context>[\s\S]*<\/environment_context>/i.test(text)) {
      addTextFragments(items, text, {
        role,
        type: "message_text",
        fallbackCategory: category,
      });
    } else if (/AGENTS\.md instructions/i.test(text)) {
      addItem(items, "project_instructions", text, {
        role,
        type: "message_text",
      });
    } else {
      addItem(items, category, text, { role, type: "message_text" });
    }
  }
}

function addTextFragments(items, text, metadata) {
  let fragments = [
    { text: String(text || ""), category: metadata.fallbackCategory },
  ];
  for (const [pattern, category] of TAGGED_CATEGORIES) {
    fragments = splitFragments(fragments, pattern, category);
  }
  fragments = splitCollaborationFragments(fragments);
  fragments = fragments.flatMap((fragment) => {
    if (
      fragment.category !== metadata.fallbackCategory ||
      !PROJECT_INSTRUCTIONS_PATTERN.test(fragment.text)
    ) {
      return [fragment];
    }
    return splitFragments(
      [fragment],
      PROJECT_INSTRUCTIONS_PATTERN,
      "project_instructions",
    );
  });
  for (const fragment of fragments) {
    if (!fragment.text) continue;
    const category =
      /CodexBridge (?:tool|interactive-tool|command|tool result|tool continuation) guidance/i.test(
        fragment.text,
      )
        ? "router_compatibility_instructions"
        : /You are Codex, a coding agent\./i.test(fragment.text)
          ? "codex_built_in_instructions"
          : fragment.category;
    addItem(items, category, fragment.text, metadata);
  }
}

function splitFragments(fragments, pattern, category) {
  const next = [];
  for (const fragment of fragments) {
    if (!TEXT_SPLITTABLE_CATEGORIES.has(fragment.category)) {
      next.push(fragment);
      continue;
    }
    let cursor = 0;
    pattern.lastIndex = 0;
    for (const match of fragment.text.matchAll(pattern)) {
      if (match.index > cursor)
        next.push({
          text: fragment.text.slice(cursor, match.index),
          category: fragment.category,
        });
      next.push({ text: match[0], category });
      cursor = match.index + match[0].length;
    }
    if (cursor < fragment.text.length)
      next.push({
        text: fragment.text.slice(cursor),
        category: fragment.category,
      });
  }
  return next;
}

function splitCollaborationFragments(fragments) {
  const next = [];
  for (const fragment of fragments) {
    let cursor = 0;
    COLLABORATION_PATTERN.lastIndex = 0;
    for (const match of fragment.text.matchAll(COLLABORATION_PATTERN)) {
      if (match.index > cursor)
        next.push({
          text: fragment.text.slice(cursor, match.index),
          category: fragment.category,
        });
      next.push({
        text: "<collaboration_mode></collaboration_mode>",
        category: "collaboration_mode_instructions",
      });
      if (match[1])
        next.push({ text: match[1], category: "developer_instructions" });
      cursor = match.index + match[0].length;
    }
    if (cursor < fragment.text.length)
      next.push({
        text: fragment.text.slice(cursor),
        category: fragment.category,
      });
  }
  return next;
}

function addItem(items, category, value, metadata = {}) {
  const metric = measurePromptValue(value);
  items.push({ category, ...metadata, ...metric });
}

function addMeasuredItem(items, category, metric, metadata = {}) {
  const characters = Math.max(0, metric.characters || 0);
  const utf8Bytes = Math.max(0, metric.utf8Bytes || 0);
  items.push({
    category,
    ...metadata,
    characters,
    utf8Bytes,
    estimatedTokens: Math.ceil(utf8Bytes / 4),
    sha256: createHash("sha256")
      .update(`${category}:${characters}:${utf8Bytes}`)
      .digest("hex"),
  });
}

function promptMessages(body) {
  if (Array.isArray(body.messages)) return body.messages;
  if (Array.isArray(body.input)) return body.input;
  if (body.input === undefined || body.input === null) return [];
  return [body.input];
}

function contentTexts(content) {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) {
    if (typeof content?.text === "string") return [content.text];
    if (typeof content?.output_text === "string") return [content.output_text];
    return content === undefined || content === null
      ? []
      : [stringifyJson(content)];
  }
  return content.flatMap(contentTexts);
}

function instructionSegments(text) {
  const values = [];
  let plain = String(text || "");
  for (const [pattern] of TAGGED_CATEGORIES) {
    pattern.lastIndex = 0;
    for (const match of plain.matchAll(pattern)) values.push(match[0].trim());
    plain = plain.replace(pattern, "\n");
  }
  COLLABORATION_PATTERN.lastIndex = 0;
  for (const match of plain.matchAll(COLLABORATION_PATTERN)) {
    if (match[1]?.trim()) values.push(match[1].trim());
  }
  plain = plain.replace(COLLABORATION_PATTERN, "\n").trim();
  if (plain) values.push(plain);
  return values.filter(Boolean);
}

function toolCallNamesById(body) {
  const result = new Map();
  for (const item of promptMessages(body)) {
    if (isResponseToolCallItem(item)) {
      result.set(item.call_id || item.id || "", item.name || item.type || "");
    }
    for (const call of item?.tool_calls || []) {
      result.set(
        call?.id || call?.call_id || "",
        call?.function?.name || call?.name || "",
      );
    }
  }
  return result;
}

function promptToolName(tool) {
  return String(tool?.function?.name || tool?.name || tool?.type || "unknown");
}

function toolCategory(name) {
  if (/mcp/i.test(name)) return "mcp_tool_schemas";
  if (/image|computer|browser|web_search/i.test(name))
    return "image_tool_capability_metadata";
  return "tool_function_schemas";
}

function toolSchemaReport(body) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const definitions = tools.map((tool) => ({
    name: promptToolName(tool),
    category: toolCategory(promptToolName(tool)),
    ...measurePromptValue(tool),
  }));
  const total = measurePromptValue(tools);
  return { count: tools.length, ...total, definitions };
}

function hasExpandedHistory(body) {
  const messages = promptMessages(body);
  const conversational = messages.filter(
    (message) =>
      ["user", "assistant", "tool"].includes(String(message?.role || "")) ||
      isResponseToolCallItem(message) ||
      isResponseToolOutputItem(message),
  );
  return conversational.length > 1;
}

function duplicateGroups(values) {
  const groups = new Map();
  for (const entry of values) {
    const normalized = String(entry.value || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!normalized) continue;
    const hash = createHash("sha256").update(normalized).digest("hex");
    const current = groups.get(hash) || { sha256: hash, count: 0, sources: [] };
    current.count += 1;
    current.sources.push(entry.source);
    groups.set(hash, current);
  }
  return [...groups.values()].filter((entry) => entry.count > 1);
}

function duplicateStrings(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }));
}

function metricDelta(from, to) {
  const characters = to.characters - from.characters;
  const utf8Bytes = to.utf8Bytes - from.utf8Bytes;
  const estimatedTokens = to.estimatedTokens - from.estimatedTokens;
  return {
    characters,
    utf8Bytes,
    estimatedTokens,
    percentage:
      from.utf8Bytes === 0
        ? 0
        : Number(((utf8Bytes / from.utf8Bytes) * 100).toFixed(2)),
  };
}

function withoutMcp(payload) {
  const copy = cloneJson(payload);
  if (Array.isArray(copy.tools))
    copy.tools = copy.tools.filter(
      (tool) => toolCategory(promptToolName(tool)) !== "mcp_tool_schemas",
    );
  return mapPromptText(copy, (text) =>
    stripPattern(
      stripPattern(text, /<mcp(?:_|\s)[^>]*>[\s\S]*?<\/mcp(?:_|\s)[^>]*>/gi),
      MCP_GUIDANCE_PATTERN,
    ),
  );
}

function withoutTaggedText(payload, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return mapPromptText(cloneJson(payload), (text) =>
    stripPattern(
      text,
      new RegExp(`<${escaped}>[\\s\\S]*?<\\/${escaped}>`, "gi"),
    ),
  );
}

function withoutProjectInstructions(payload) {
  return mapPromptText(cloneJson(payload), (text) =>
    stripPattern(text, PROJECT_INSTRUCTIONS_PATTERN),
  );
}

function withMinimalTools(payload) {
  const copy = cloneJson(payload);
  if (Array.isArray(copy.tools)) {
    copy.tools = copy.tools.filter((tool) =>
      ["exec_command", "write_stdin", "apply_patch"].includes(
        promptToolName(tool),
      ),
    );
  }
  return copy;
}

function withoutHistory(payload) {
  const copy = cloneJson(payload);
  const key = Array.isArray(copy.messages)
    ? "messages"
    : Array.isArray(copy.input)
      ? "input"
      : null;
  if (!key) return copy;
  const messages = copy[key];
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (
      messages[index]?.role === "user" &&
      !/<environment_context>/i.test(stringifyJson(messages[index]))
    ) {
      lastUserIndex = index;
      break;
    }
  }
  copy[key] = messages.filter((message, index) => {
    if (["system", "developer"].includes(String(message?.role || "")))
      return true;
    if (/<environment_context>/i.test(stringifyJson(message))) return true;
    return index === lastUserIndex;
  });
  if (copy.previous_response_id) delete copy.previous_response_id;
  return copy;
}

function mapPromptText(payload, transform) {
  if (typeof payload.instructions === "string")
    payload.instructions = transform(payload.instructions);
  for (const message of promptMessages(payload)) {
    if (typeof message?.content === "string")
      message.content = transform(message.content);
    if (Array.isArray(message?.content)) {
      for (const part of message.content) {
        if (typeof part?.text === "string") part.text = transform(part.text);
        if (typeof part?.output_text === "string")
          part.output_text = transform(part.output_text);
      }
    }
  }
  return payload;
}

function stripPattern(text, pattern) {
  const original = String(text || "");
  const stripped = original.replace(pattern, "");
  if (stripped === original) return original;
  return stripped.replace(/\n{3,}/g, "\n\n").trim();
}
