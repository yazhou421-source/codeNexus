import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createRouterServer } from "./server.js";
import { responsesToChatRequest } from "./responses-to-chat.js";
// @ts-expect-error Legacy JS history has no declaration.
import { ResponseHistory } from "./history.js";
import {
  inspectToolContinuation,
  stateWithAssistant,
} from "./tool-loop-guard.js";
import { upstreamDiagnostic } from "./upstream-diagnostics.js";

const servers: Server[] = [];
const listen = async (server: Server) => {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
};
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

const route = {
  id: "deepseek-v4-flash",
  displayName: "DeepSeek",
  model: "deepseek-v4-flash",
  provider: "deepseek",
  api: "chat_completions" as const,
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "synthetic-test-key",
  contextWindow: 1_000_000,
  dropParams: ["parallel_tool_calls", "response_format"],
};

describe("DeepSeek continuation with actual Responses output replay", () => {
  it.each([
    [true, false, "function", false],
    [true, true, "function", false],
    [false, false, "function", false],
    [false, true, "function", false],
    [true, false, "custom", false],
    [true, true, "custom", false],
    [true, false, "function", true],
    [true, true, "function", true],
  ])(
    "eight rounds + final: stream=%s previous=%s tool=%s parallel=%s",
    async (stream, previous, kind, parallel) => {
      const requests: any[] = [];
      const tools =
        kind === "custom"
          ? [{ type: "custom", name: "fixture", format: { type: "text" } }]
          : [
              {
                type: "function",
                name: "exec_command",
                parameters: {
                  type: "object",
                  properties: { cmd: { type: "string" } },
                  required: ["cmd"],
                },
              },
            ];
      const upstream = await listen(
        createServer(async (req, res) => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString());
          requests.push(body);
          // Model the observed provider requirement, and independently verify pairs.
          const assistants = body.messages.filter(
            (m: any) => m.role === "assistant",
          );
          if (assistants.some((m: any) => !m.reasoning_content)) {
            res.writeHead(400);
            res.end(
              JSON.stringify({
                error: {
                  code: "invalid_request_error",
                  type: "invalid_request_error",
                  param: null,
                  message:
                    "The `reasoning_content` in the thinking mode must be passed back to the API.",
                },
              }),
            );
            return;
          }
          const round = requests.length;
          const calls =
            round <= 8
              ? Array.from({ length: parallel ? 2 : 1 }, (_, i) => ({
                  id: `provider_call_${round}_${i}`,
                  type: "function",
                  function: {
                    name: kind === "custom" ? "fixture" : "exec_command",
                    arguments: JSON.stringify(
                      kind === "custom"
                        ? { input: `read fixture ${round}_${i}` }
                        : { cmd: `cat fixture${round}_${i}.txt` },
                    ),
                  },
                }))
              : [];
          const message = {
            role: "assistant",
            content: `Inspection step ${round}`,
            reasoning_content: `provider reasoning ${round}`,
            ...(calls.length ? { tool_calls: calls } : {}),
          };
          if (!body.stream) {
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                id: `chat_${round}`,
                choices: [
                  {
                    message,
                    finish_reason: calls.length ? "tool_calls" : "stop",
                  },
                ],
              }),
            );
            return;
          }
          res.setHeader("content-type", "text/event-stream");
          const delta = (value: any, finish_reason: any = null) =>
            res.write(
              `data: ${JSON.stringify({ choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`,
            );
          delta({ reasoning_content: "provider " });
          delta({ reasoning_content: `reasoning ${round}` });
          delta({ content: message.content });
          for (const [index, call] of calls.entries()) {
            delta({
              tool_calls: [
                {
                  index,
                  id: call.id,
                  type: "function",
                  function: { name: call.function.name, arguments: "" },
                },
              ],
            });
            delta({
              tool_calls: [
                { index, function: { arguments: call.function.arguments } },
              ],
            });
          }
          delta({}, calls.length ? "tool_calls" : "stop");
          res.end("data: [DONE]\n\n");
        }),
      );
      const origin = await listen(
        createRouterServer({
          authToken: "fixture",
          models: [{ ...route, baseUrl: upstream }],
        }),
      );
      const initial = [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "Inspect the synthetic fixture." },
          ],
        },
      ];
      let input: any[] = initial;
      let prior: string | undefined;
      let final = false;
      for (let round = 1; round <= 9; round++) {
        const response = await fetch(`${origin}/v1/responses`, {
          method: "POST",
          headers: {
            authorization: "Bearer fixture",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: route.id,
            input,
            tools,
            stream,
            previous_response_id: previous ? prior : undefined,
            service_tier: "priority",
          }),
        });
        expect(response.status).toBe(200);
        const raw = await response.text();
        const result = stream
          ? raw
              .split("\n")
              .filter((line) => line.startsWith("data: {"))
              .map((line) => JSON.parse(line.slice(6)))
              .find((e) => e.type === "response.completed")?.response
          : JSON.parse(raw);
        expect(result?.status).toBe("completed");
        expect(result.stop_reason).toBeUndefined();
        const calls = result.output.filter((item: any) =>
          item.type.endsWith("_call"),
        );
        if (round === 9) {
          expect(calls).toHaveLength(0);
          final = true;
          break;
        }
        expect(calls).toHaveLength(parallel ? 2 : 1);
        const outputs = calls.map((call: any, i: number) => ({
          type:
            kind === "custom"
              ? "custom_tool_call_output"
              : "function_call_output",
          call_id: call.call_id,
          output:
            round === 4
              ? "large synthetic output ".repeat(15000)
              : `result ${round}_${i}`,
        }));
        input = previous ? outputs : [...input, ...result.output, ...outputs];
        prior = result.id;
      }
      expect(final).toBe(true);
      expect(requests).toHaveLength(9);
      for (const [round, body] of requests.entries()) {
        expect(body.service_tier).toBeUndefined();
        expect(body.tools).toHaveLength(1);
        expect(
          body.messages.filter((m: any) => m.role === "assistant"),
        ).toHaveLength(round);
        for (let i = 0; i < body.messages.length; i++) {
          const m = body.messages[i];
          if (m.tool_calls) {
            expect(m.reasoning_content).toBe(
              `provider reasoning ${body.messages.filter((v: any, j: number) => j <= i && v.role === "assistant").length}`,
            );
            for (const [offset, call] of m.tool_calls.entries())
              expect(body.messages[i + 1 + offset]).toMatchObject({
                role: "tool",
                tool_call_id: call.id,
              });
          }
        }
        if (round >= 4)
          expect(
            body.messages.find(
              (m: any) =>
                m.role === "tool" && m.tool_call_id === "provider_call_4_0",
            ).content,
          ).toBe("large synthetic output ".repeat(15000));
      }
    },
  );
  it("drops unsupported Fast fields before DeepSeek wire conversion", () => {
    const convert = (tier?: string) =>
      responsesToChatRequest(
        { input: "synthetic", service_tier: tier, speed: "fast" },
        route,
        undefined,
      ).body;
    expect(convert("priority")).toEqual(convert());
  });
});

describe("safe provider diagnostic", () => {
  it("delivers requestId, status and safe size counts to the application sink", async () => {
    const records: any[] = [];
    const upstream = await listen(
      createServer((_req, res) => {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message:
                "The `reasoning_content` in the thinking mode must be passed back to the API.",
              code: "invalid_request_error",
              type: "invalid_request_error",
              param: null,
            },
          }),
        );
      }),
    );
    const origin = await listen(
      createRouterServer(
        { authToken: "fixture", models: [{ ...route, baseUrl: upstream }] },
        {
          onUpstreamDiagnostic: (record) => {
            records.push(record);
          },
        },
      ),
    );
    const response = await fetch(`${origin}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: route.id,
        input: "synthetic diagnostic input",
      }),
    });
    expect(response.status).toBe(400);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      route: route.id,
      status: 400,
      type: "invalid_request_error",
      request: { contextWindow: 1000000, serviceTierForwarded: false },
    });
    expect(records[0].requestId).toMatch(/^req_/);
    expect(JSON.stringify(records)).not.toContain("synthetic diagnostic input");
  });

  it("retains the actual provider error fields without body/prompt/header leakage", () => {
    const message =
      "The `reasoning_content` in the thinking mode must be passed back to the API.";
    const result = upstreamDiagnostic(
      "req_fixture",
      route,
      {
        statusCode: 400,
        bodyText: JSON.stringify({
          error: {
            message,
            code: "invalid_request_error",
            type: "invalid_request_error",
            param: null,
          },
          prompt: "PRIVATE FILE",
          Authorization: "Bearer secret-value",
        }),
      },
      ["secret-value"],
    );
    expect(result).toMatchObject({
      status: 400,
      code: "invalid_request_error",
      type: "invalid_request_error",
      param: null,
      message,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE FILE|secret-value|Authorization/,
    );
  });
  it("omits unrecognized messages, including source echoed by a provider", () => {
    const result = upstreamDiagnostic(
      "req_fixture",
      route,
      {
        statusCode: 400,
        bodyText: JSON.stringify({
          error: {
            message: "Source: PRIVATE FILE key secret-value",
            code: "secret-value",
            param: "invalid source text",
          },
        }),
      },
      ["secret-value"],
    );
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE FILE|secret-value/);
    expect(result?.param).toBeNull();
  });
});

describe("replay identity and PR3 history isolation", () => {
  const original = {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: "Inspecting." }],
  };
  const assistant = {
    role: "assistant",
    content: "Inspecting.",
    reasoning_content: "private provider reasoning",
  };
  const seeded = () => {
    const history = new ResponseHistory();
    history.record("resp_fixture", [assistant]);
    history.recordResponse(
      { id: "resp_fixture", output: [original] },
      { routeId: route.id, upstreamModel: route.model },
    );
    return history;
  };
  it("requires the exact emitted ID, content, route and upstream model", () => {
    const history = seeded();
    expect(history.restoreAssistantReplay([original], route)).toEqual([
      assistant,
    ]);
    for (const changed of [
      { ...original, id: "another" },
      { ...original, content: [{ type: "output_text", text: "changed" }] },
    ])
      expect(history.restoreAssistantReplay([changed], route)).toEqual([
        changed,
      ]);
    expect(
      history.restoreAssistantReplay([original], { ...route, id: "another" }),
    ).toEqual([original]);
    expect(
      history.restoreAssistantReplay([original], {
        ...route,
        model: "another",
      }),
    ).toEqual([original]);
  });
  it("evicts replay reasoning together with bounded history and cannot attach stale entries", () => {
    const history = seeded();
    history.maxEntries = 1;
    history.record("resp_new", [{ role: "assistant", content: "new" }]);
    expect(history.restoreAssistantReplay([original], route)).toEqual([
      original,
    ]);
  });
  it("PR3 guard functions add metadata without mutating assistant/tool history", () => {
    const chat = {
      choices: [
        {
          message: {
            ...assistant,
            tool_calls: [
              {
                id: "provider_id",
                type: "function",
                function: {
                  name: "exec_command",
                  arguments: '{"cmd":"cat fixture1"}',
                },
              },
            ],
          },
        },
      ],
    };
    const messages = [
      chat.choices[0].message,
      { role: "tool", tool_call_id: "provider_id", content: "fixture result" },
    ];
    const before = JSON.stringify(messages);
    const inspected = inspectToolContinuation(messages, null, route);
    const stateBefore = JSON.stringify(inspected.state);
    stateWithAssistant(inspected.state, chat);
    expect(inspected.stop).toBeNull();
    expect(JSON.stringify(messages)).toBe(before);
    expect(JSON.stringify(inspected.state)).toBe(stateBefore);
  });
});
