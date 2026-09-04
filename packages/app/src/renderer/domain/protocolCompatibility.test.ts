import type { OfficialCodexServerRequest } from "@codenexus/shared/codex-protocol";
import { describe, expect, it } from "vitest";
import { normalizeApprovalPolicy } from "./serverInterop";
import { normalizeUserInputPrompt } from "./userInputInterop";

describe("Codex 0.153.2 protocol compatibility", () => {
  it("maps the removed on-failure approval policy to on-request", () => {
    expect(normalizeApprovalPolicy("on-failure")).toBe("on-request");
  });

  it.each(["form", "openai/form", "openaiForm"] as const)(
    "normalizes the %s MCP elicitation mode as a form",
    (mode) => {
      const request = {
        id: 7,
        method: "mcpServer/elicitation/request",
        params: {
          mode,
          _meta: null,
          threadId: "thread-1",
          turnId: null,
          serverName: "example-server",
          message: "Choose a value",
          requestedSchema: { type: "object" },
        },
      } as OfficialCodexServerRequest;

      expect(normalizeUserInputPrompt(request, "server-1")).toMatchObject({
        kind: "elicitationForm",
        serverId: "server-1",
        requestId: 7,
        threadId: "thread-1",
        serverName: "example-server",
        message: "Choose a value",
      });
    }
  );
});
