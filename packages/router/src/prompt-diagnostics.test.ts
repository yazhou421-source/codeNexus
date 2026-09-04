import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { responsesToChatRequest } from "./responses-to-chat.js";
import {
  analyzePromptPair,
  analyzePromptPayload,
  buildPromptToggleMeasurements,
  detectPromptDuplicates,
  diagnosticReportContainsSensitiveValue,
} from "./prompt-diagnostics.js";

const route = {
  id: "diagnostic-model",
  model: "diagnostic-upstream-model",
  api: "chat_completions",
  baseUrl: "http://127.0.0.1:9/v1",
};

function metricFor(
  report: ReturnType<typeof analyzePromptPayload>,
  category: string,
) {
  return report.breakdown.find((entry) => entry.category === category)!;
}

function functionTool(name: string, description = "Synthetic diagnostic tool") {
  return {
    type: "function",
    name,
    description,
    parameters: {
      type: "object",
      properties: { value: { type: "string", description: "Synthetic value" } },
      required: ["value"],
      additionalProperties: false,
    },
  };
}

describe("prompt diagnostics", () => {
  it("classifies prompt categories and accounts for the complete payload", () => {
    const report = analyzePromptPayload({
      model: "diagnostic-model",
      instructions: "You are Codex, a coding agent.",
      input: [
        {
          role: "developer",
          content: [
            { type: "input_text", text: "Developer policy" },
            {
              type: "input_text",
              text: "<skills_instructions>Synthetic skill</skills_instructions>",
            },
            {
              type: "input_text",
              text: "<environment_context><cwd>/tmp/synthetic</cwd></environment_context>",
            },
          ],
        },
        { role: "user", content: [{ type: "input_text", text: "Reply OK" }] },
      ],
      tools: [functionTool("exec_command")],
    });

    expect(
      metricFor(report, "codex_built_in_instructions").utf8Bytes,
    ).toBeGreaterThan(0);
    expect(
      metricFor(report, "developer_instructions").utf8Bytes,
    ).toBeGreaterThan(0);
    expect(metricFor(report, "skills_instructions").utf8Bytes).toBeGreaterThan(
      0,
    );
    expect(
      metricFor(report, "workspace_context_injections").utf8Bytes,
    ).toBeGreaterThan(0);
    expect(metricFor(report, "user_messages").utf8Bytes).toBeGreaterThan(0);
    expect(
      metricFor(report, "tool_function_schemas").utf8Bytes,
    ).toBeGreaterThan(0);
    expect(
      report.breakdown.reduce((sum, entry) => sum + entry.utf8Bytes, 0),
    ).toBe(report.total.utf8Bytes);
  });

  it("emits secret-free diagnostics", () => {
    const syntheticSecret = `synthetic-${randomUUID()}`;
    const report = analyzePromptPayload({
      model: "diagnostic-model",
      input: [{ role: "user", content: syntheticSecret }],
      authorization: syntheticSecret,
    });

    expect(
      diagnosticReportContainsSensitiveValue(report, [syntheticSecret]),
    ).toBe(false);
    expect(JSON.stringify(report)).not.toContain(syntheticSecret);
  });

  it("detects duplicated system/developer instructions", () => {
    const duplicated = "Synthetic instruction that must appear once";
    const duplicates = detectPromptDuplicates({
      instructions: duplicated,
      input: [{ role: "developer", content: duplicated }],
    });

    expect(duplicates.systemInstructions).toHaveLength(1);
    expect(duplicates.systemInstructions[0].count).toBe(2);
  });

  it("detects duplicated tool names and schemas", () => {
    const tool = functionTool("duplicate_tool");
    const duplicates = detectPromptDuplicates({ tools: [tool, tool] });

    expect(duplicates.toolsByName).toEqual([
      { value: "duplicate_tool", count: 2 },
    ]);
    expect(duplicates.toolsBySchema).toHaveLength(1);
  });

  it("detects duplicated conversation history", () => {
    const message = { role: "assistant", content: "Synthetic previous answer" };
    const duplicates = detectPromptDuplicates({ messages: [message, message] });
    expect(duplicates.history).toHaveLength(1);
  });

  it("detects duplicated tool results", () => {
    const result = {
      role: "tool",
      tool_call_id: "call_1",
      content: "synthetic output",
    };
    const duplicates = detectPromptDuplicates({ messages: [result, result] });
    expect(duplicates.toolResults).toHaveLength(1);
  });

  it("keeps Responses to Chat conversion size within a regression bound", () => {
    const responses = {
      model: "diagnostic-model",
      instructions: "Synthetic system instruction",
      input: [
        { role: "user", content: [{ type: "input_text", text: "Reply OK" }] },
      ],
      tools: [functionTool("exec_command"), functionTool("apply_patch")],
      stream: true,
    };
    const chat = responsesToChatRequest(responses, route, null).body;
    const report = analyzePromptPair(responses, chat);

    expect(report.conversionDelta.percentage).toBeLessThan(25);
    expect(report.chat.total.utf8Bytes).toBeLessThan(
      responsesToLooseUpperBound(report.responses.total.utf8Bytes),
    );
  });

  it("measures a fresh thread without inventing history", () => {
    const report = analyzePromptPayload({
      instructions: "Synthetic system",
      input: [{ role: "user", content: "First turn" }],
      tools: [functionTool("exec_command")],
    });

    expect(metricFor(report, "user_messages").itemCount).toBe(1);
    expect(metricFor(report, "assistant_history").itemCount).toBe(0);
    expect(metricFor(report, "tool_results_history").itemCount).toBe(0);
  });

  it("measures second-turn history and the no-history counterfactual", () => {
    const payload = {
      messages: [
        { role: "system", content: "Synthetic system" },
        { role: "user", content: "First turn" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Second turn" },
      ],
      tools: [functionTool("exec_command")],
    };
    const report = analyzePromptPayload(payload);
    const toggles = buildPromptToggleMeasurements(payload);

    expect(metricFor(report, "assistant_history").itemCount).toBe(1);
    expect(
      toggles.find((entry) => entry.name === "no_history")!.utf8Bytes,
    ).toBeLessThan(toggles.find((entry) => entry.name === "full")!.utf8Bytes);
  });

  it("measures a no-tool prompt while retaining available Agent schemas", () => {
    const report = analyzePromptPayload({
      messages: [{ role: "user", content: "Reply OK without calling tools" }],
      tools: [functionTool("exec_command")],
    });

    expect(report.tools.count).toBe(1);
    expect(metricFor(report, "shell_command_output").itemCount).toBe(0);
  });

  it("measures MCP enabled/disabled without exposing schema content", () => {
    const payload = {
      messages: [{ role: "user", content: "Synthetic MCP task" }],
      tools: [
        functionTool("exec_command"),
        functionTool("list_mcp_resources"),
        functionTool("mcp__synthetic__lookup", "Private MCP description"),
      ],
    };
    const report = analyzePromptPayload(payload);
    const toggles = buildPromptToggleMeasurements(payload);

    expect(metricFor(report, "mcp_tool_schemas").itemCount).toBe(2);
    expect(
      toggles.find((entry) => entry.name === "mcp_disabled")!.utf8Bytes,
    ).toBeLessThan(toggles.find((entry) => entry.name === "full")!.utf8Bytes);
    expect(JSON.stringify(report)).not.toContain("Private MCP description");
  });

  it("measures Skills enabled/disabled", () => {
    const payload = {
      messages: [
        {
          role: "system",
          content:
            "<skills_instructions>Large synthetic skill catalog</skills_instructions>",
        },
        { role: "user", content: "Reply OK" },
      ],
    };
    const report = analyzePromptPayload(payload);
    const toggles = buildPromptToggleMeasurements(payload);

    expect(metricFor(report, "skills_instructions").itemCount).toBe(1);
    expect(
      toggles.find((entry) => entry.name === "skills_disabled")!.utf8Bytes,
    ).toBeLessThan(toggles.find((entry) => entry.name === "full")!.utf8Bytes);
  });

  it("flags previous_response_id combined with expanded history", () => {
    const duplicates = detectPromptDuplicates({
      previous_response_id: "resp_synthetic",
      input: [
        { role: "user", content: "First turn" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Second turn" },
      ],
    });
    expect(duplicates.previousResponseWithExpandedHistory).toBe(true);
  });

  it("does not add tool continuation guidance for results before a newer user turn", () => {
    const chat = responsesToChatRequest(
      {
        input: [
          { role: "user", content: "Read a synthetic file" },
          {
            type: "function_call",
            call_id: "call_1",
            name: "exec_command",
            arguments: '{"cmd":"pwd"}',
          },
          {
            type: "function_call_output",
            call_id: "call_1",
            output: "synthetic output",
          },
          { role: "user", content: "Now answer a new question" },
        ],
        tools: [functionTool("exec_command")],
      },
      route,
      null,
    ).body;

    expect(JSON.stringify(chat.messages)).not.toContain(
      "latest user turn contains tool outputs",
    );
  });
});

function responsesToLooseUpperBound(bytes: number) {
  return Math.ceil(bytes * 1.25);
}
