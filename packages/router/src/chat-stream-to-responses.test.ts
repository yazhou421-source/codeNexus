import { describe, expect, it, vi } from "vitest";
import { consumeSse, consumeSseBuffer } from "./chat-stream-to-responses.js";

describe("Chat Completions SSE parser", () => {
  it("handles CRLF, comments, event fields, and multiple data lines", () => {
    const values: string[] = [];
    let buffer = "";
    buffer +=
      ": keepalive\r\nevent: message\r\ndata: first\r\ndata: second\r\n\r\n";
    buffer += "data: [DONE]\n\ntrailing";

    const remainder = consumeSseBuffer(buffer, (value) => values.push(value));

    expect(values).toEqual(["first\nsecond", "[DONE]"]);
    expect(remainder).toBe("trailing");
  });

  it("handles arbitrary transport chunk boundaries and UTF-8 characters", async () => {
    const source = new TextEncoder().encode(
      'data: {"text":"你好"}\n\ndata: [DONE]\n\n',
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < source.length; index += 2) {
          controller.enqueue(source.slice(index, index + 2));
        }
        controller.close();
      },
    });
    const values: string[] = [];

    await consumeSse(body, (value) => values.push(value));

    expect(values).toEqual(['{"text":"你好"}', "[DONE]"]);
  });

  it("cancels a stalled stream after the safe idle timeout", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });

    await expect(
      consumeSse(body, () => undefined, { timeoutMs: 5 }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    expect(cancel).toHaveBeenCalled();
  });
});
