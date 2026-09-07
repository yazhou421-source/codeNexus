import { createServer, get, type ServerResponse } from "node:http";
import { once } from "node:events";
import { describe, it, expect } from "vitest";
import { writeSse } from "./chat-stream-to-responses.js";

describe("localhost SSE backpressure", () => {
  it("bounds the write queue and stops on client close while waiting for drain", async () => {
    let written = 0,
      backpressure = 0,
      maxQueuedBytes = 0;
    let stopped!: () => void;
    const finished = new Promise<void>((resolve) => {
      stopped = resolve;
    });
    const server = createServer(async (_req, res) => {
      const original = res.write.bind(res);
      res.write = ((...args: any[]) => {
        const ok = (original as any)(...args);
        if (!ok) backpressure++;
        maxQueuedBytes = Math.max(maxQueuedBytes, res.writableLength);
        return ok;
      }) as ServerResponse["write"];
      res.writeHead(200, { "content-type": "text/event-stream" });
      try {
        for (let i = 0; i < 10_000; i++) {
          await writeSse(res, "response.output_text.delta", {
            delta: "x".repeat(8192),
          });
          written++;
        }
        res.end();
      } catch {
        /* A closed downstream deliberately rejects the writer. */
      } finally {
        stopped();
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as any).port;
    const client = get(`http://127.0.0.1:${port}`);
    try {
      const [response] = await once(client, "response");
      response.pause();
      await new Promise((r) => setTimeout(r, 40));
      expect(backpressure).toBeGreaterThan(0);
      expect(written).toBeLessThan(10_000);
      expect(maxQueuedBytes).toBeLessThan(128 * 1024);
      response.destroy();
      client.destroy();
      await finished;
    } finally {
      client.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
