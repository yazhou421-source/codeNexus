import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));
import { CodexAppServer } from "./codexAppServer";
import { createCodexRouterRuntime } from "./codexRouterRuntime";
import { createRouterServer } from "../../../router/src/server.js";
import { parseToolPause, TOOL_PAUSE_CONTINUE_PROMPT } from "../renderer/domain/toolPause";

const executable = resolve("packages/app/build/codex-runtime/mac-arm64/bin/codex");

describe("tool pause through the bundled app-server", () => {
  it.runIf(process.platform === "darwin" && existsSync(executable))(
    "transports the pause envelope, retains tool outputs, and resumes the same thread",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "calmnova-tool-pause-"));
      const codexHome = join(root, "codex");
      await mkdir(codexHome);
      const requests: any[] = [];
      let continuing = false;
      const upstream = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        requests.push(body);
        const tool = body.tools.find((tool: any) => tool.function.name.includes("read_file"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: `chatcmpl_actual_${requests.length}`,
            choices: [
              {
                message: continuing
                  ? {
                      role: "assistant",
                      content: "Continued analysis using the retained latest result",
                    }
                  : {
                      role: "assistant",
                      tool_calls: [
                        {
                          id: `call_${requests.length}`,
                          type: "function",
                          function: { name: tool.function.name, arguments: '{"path":"README.md"}' },
                        },
                      ],
                    },
              },
            ],
          })
        );
      });
      await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
      const router = createRouterServer({
        host: "127.0.0.1",
        port: 0,
        authToken: "test-token",
        models: [
          {
            id: "deepseek-v4-pro",
            displayName: "DeepSeek V4 Pro",
            api: "chat_completions",
            model: "deepseek-v4-pro",
            baseUrl: `http://127.0.0.1:${(upstream.address() as any).port}/v1`,
            apiKey: "synthetic-key",
          },
        ],
      });
      await new Promise<void>((done) => router.listen(0, "127.0.0.1", done));
      const runtime = createCodexRouterRuntime({
        origin: `http://127.0.0.1:${(router.address() as any).port}`,
        authToken: "test-token",
        routes: [{ modelId: "deepseek-v4-pro", authMode: "api_key" }],
      })!;
      runtime.childEnv = { ...runtime.childEnv, CODEX_HOME: codexHome };
      const completed = new Set<string>();
      const answers: string[] = [];
      let toolCalls = 0;
      const server = new CodexAppServer({
        id: "tool-pause-integration",
        experimentalApiOptIn: true,
        mode: "native",
        cwd: root,
        runtimeConfig: runtime,
        resolveExecutable: async () =>
          ({
            source: "bundled",
            version: "0.153.2",
            path: executable,
            command: { kind: "direct", path: executable },
          }) as any,
        onMessage(message) {
          if (!("method" in message)) return;
          const params = message.params as any;
          if (message.method === "item/tool/call" && "id" in message) {
            toolCalls++;
            server.respond(message.id, {
              success: true,
              contentItems: [{ type: "inputText", text: "latest retained README result" }],
            });
          }
          if (message.method === "item/completed" && params.item?.type === "agentMessage")
            answers.push(params.item.text);
          if (message.method === "turn/completed") completed.add(params.turn.id);
        },
      });
      try {
        await server.start();
        const started = await server.request("thread/start", {
          model: "deepseek-v4-pro",
          cwd: root,
          sandbox: "read-only",
          approvalPolicy: "never",
          dynamicTools: [
            {
              type: "function",
              name: "read_file",
              description: "Read a project file",
              inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
            },
          ],
        });
        const send = async (text: string) => {
          const result = await server.request("turn/start", {
            threadId: started.thread.id,
            input: [{ type: "text", text, text_elements: [] }],
          });
          await vi.waitFor(() => expect(completed.has(result.turn.id)).toBe(true), { timeout: 15_000, interval: 25 });
        };
        await send("帮我看看项目，只读不改代码");
        expect(toolCalls).toBe(3);
        expect(requests).toHaveLength(3);
        expect(parseToolPause(answers.at(-1))).toMatchObject({ reason: "tool_loop_guard" });
        continuing = true;
        await send(TOOL_PAUSE_CONTINUE_PROMPT);
        expect(requests).toHaveLength(4);
        expect(toolCalls).toBe(3);
        expect(JSON.stringify(requests.at(-1).messages)).toContain("latest retained README result");
        expect(answers.at(-1)).toBe("Continued analysis using the retained latest result");
      } finally {
        await server.stop();
        await Promise.all([
          new Promise<void>((done) => router.close(() => done())),
          new Promise<void>((done) => upstream.close(() => done())),
        ]);
        await rm(root, { recursive: true, force: true });
      }
    },
    40_000
  );
});
