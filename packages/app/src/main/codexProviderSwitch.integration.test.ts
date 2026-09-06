import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));

import { CodexAppServer } from "./codexAppServer";
import { createCodexRouterRuntime } from "./codexRouterRuntime";

const executable = resolve("packages/app/build/codex-runtime/mac-arm64/bin/codex");

describe("bundled app-server provider switching (isolated loopback, no real model)", () => {
  it.runIf(process.platform === "darwin" && process.arch === "arm64" && existsSync(executable))(
    "sends GPT → DeepSeek → Kimi → GPT through the actual provider endpoints",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "calmnova-provider-switch-"));
      const codexHome = join(root, "home");
      await mkdir(codexHome);
      await writeFile(join(codexHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "synthetic-codex-auth" }));
      const requests: Array<{ url: string; model: string; authorization: string }> = [];
      const upstream = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        requests.push({ url: req.url!, model: body.model, authorization: req.headers.authorization! });
        res.writeHead(200, { "content-type": "text/event-stream" });
        const item = {
          id: "msg-probe",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "OK", annotations: [] }],
        };
        const response = {
          id: `resp-${requests.length}`,
          object: "response",
          status: "completed",
          model: body.model,
          output: [item],
          usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
        };
        for (const event of [
          { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { ...item, status: "in_progress", content: [] },
          },
          { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "OK" },
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response },
        ])
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        res.end();
      });
      let server: CodexAppServer | undefined;
      try {
        await new Promise<void>((done, reject) => {
          upstream.once("error", reject);
          upstream.listen(0, "127.0.0.1", done);
        });
        const address = upstream.address() as { port: number };
        const runtime = createCodexRouterRuntime({
          origin: `http://127.0.0.1:${address.port}`,
          authToken: "synthetic-router-token",
          routes: [
            { modelId: "gpt-5.5", authMode: "codex_openai" },
            { modelId: "deepseek-v4-flash", authMode: "api_key" },
            { modelId: "kimi-k2-7-code", authMode: "api_key" },
          ],
        })!;
        runtime.childEnv = {
          ...runtime.childEnv,
          HOME: root,
          CODEX_HOME: codexHome,
        };
        const completed = new Map<string, string>();
        server = new CodexAppServer({
          id: "integration",
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
            if ("method" in message && message.method === "turn/completed")
              completed.set((message.params as any).turn.id, (message.params as any).turn.status);
          },
        });
        await server.start();
        const started = await server.request("thread/start", { model: "gpt-5.5", cwd: root });
        const threadId = started.thread.id;
        for (const model of ["gpt-5.5", "deepseek-v4-flash", "kimi-k2-7-code", "gpt-5.5"]) {
          const result = await server.request("turn/start", {
            threadId,
            model,
            input: [{ type: "text", text: "Only reply OK. Do not use tools.", text_elements: [] }],
          } as any);
          await vi.waitFor(() => expect(completed.get(result.turn.id)).toBe("completed"), {
            timeout: 15_000,
            interval: 50,
          });
        }
        expect(requests).toEqual([
          { url: "/codex-auth/v1/responses", model: "gpt-5.5", authorization: "Bearer synthetic-codex-auth" },
          { url: "/v1/responses", model: "deepseek-v4-flash", authorization: "Bearer synthetic-router-token" },
          { url: "/v1/responses", model: "kimi-k2-7-code", authorization: "Bearer synthetic-router-token" },
          { url: "/codex-auth/v1/responses", model: "gpt-5.5", authorization: "Bearer synthetic-codex-auth" },
        ]);
      } finally {
        server?.stop();
        upstream.closeAllConnections();
        await new Promise<void>((done) => upstream.close(() => done()));
        await rm(root, { recursive: true, force: true });
      }
    },
    60_000
  );
});
