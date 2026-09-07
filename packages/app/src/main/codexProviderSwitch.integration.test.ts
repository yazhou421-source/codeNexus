import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
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
      let official: CodexAppServer | undefined;
      const officialUpstream = createServer(upstream.listeners("request")[0] as any);
      try {
        await new Promise<void>((done, reject) => {
          upstream.once("error", reject);
          upstream.listen(0, "127.0.0.1", done);
        });
        await new Promise<void>((done) => officialUpstream.listen(0, "127.0.0.1", done));
        const officialPort = (officialUpstream.address() as { port: number }).port;
        const configPath = join(codexHome, "config.toml");
        const original = `# preserve user formatting
model_provider = "user-provider"
model = "gpt-5.5"
[model_providers.user-provider]
name = "User"
base_url = "http://127.0.0.1:${officialPort}/official/v1"
wire_api = "responses"
requires_openai_auth = true
`;
        await writeFile(configPath, original);
        vi.stubEnv("CODEX_HOME", codexHome);
        vi.stubEnv("HOME", root);
        const officialCompleted = new Set<string>();
        official = new CodexAppServer({
          id: "official-independent",
          mode: "native",
          cwd: root,
          resolveExecutable: async () => ({
            source: "bundled",
            version: "0.153.2",
            path: executable,
            command: { kind: "direct", path: executable },
          }),
          onMessage(message) {
            if (
              "method" in message &&
              message.method === "turn/completed" &&
              (message.params as any).turn.status === "completed"
            )
              officialCompleted.add((message.params as any).turn.id);
          },
        });
        await official.start();
        const officialThread = await official.request("thread/start", { model: "gpt-5.5", cwd: root });
        const sendOfficial = async () => {
          const turn = await official!.request("turn/start", {
            threadId: officialThread.thread.id,
            input: [{ type: "text", text: "Reply OK only", text_elements: [] }],
          });
          await vi.waitFor(() => expect(officialCompleted.has(turn.turn.id)).toBe(true), {
            timeout: 15_000,
            interval: 50,
          });
          expect(await readFile(configPath, "utf8")).toBe(original);
        };
        await sendOfficial();
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
        // P0-2: the independent process stays on the user's endpoint concurrently.
        await sendOfficial();
        expect(requests.filter((r) => r.url !== "/official/v1/responses")).toEqual([
          { url: "/codex-auth/v1/responses", model: "gpt-5.5", authorization: "Bearer synthetic-codex-auth" },
          { url: "/v1/responses", model: "deepseek-v4-flash", authorization: "Bearer synthetic-router-token" },
          { url: "/v1/responses", model: "kimi-k2-7-code", authorization: "Bearer synthetic-router-token" },
          { url: "/codex-auth/v1/responses", model: "gpt-5.5", authorization: "Bearer synthetic-codex-auth" },
        ]);
        // P0-1/P0-3: normal Calmnova exit leaves exact config bytes and official turns intact.
        server.stop();
        await sendOfficial();
        // P0-4: losing the Router listener also has no effect on the other process.
        upstream.closeAllConnections();
        await new Promise<void>((done) => upstream.close(() => done()));
        await sendOfficial();
        expect(requests.filter((r) => r.url === "/official/v1/responses")).toHaveLength(4);
        expect(await readFile(configPath, "utf8")).toBe(original);
      } finally {
        server?.stop();
        official?.stop();
        vi.unstubAllEnvs();
        officialUpstream.closeAllConnections();
        await new Promise<void>((done) => officialUpstream.close(() => done()));
        upstream.closeAllConnections();
        await new Promise<void>((done) => upstream.close(() => done()));
        await rm(root, { recursive: true, force: true });
      }
    },
    60_000
  );
});
