import { describe, expect, it } from "vitest";
import { buildCurrentTimeReadResponse, classifyServerRequest } from "./requestHandlers";

describe("Codex 0.153.2 server request handling", () => {
  it("classifies currentTime/read as a locally handled request", () => {
    expect(classifyServerRequest("currentTime/read")).toEqual({
      kind: "currentTime",
      isKnownMethod: true,
      requiresResponse: true,
    });
  });

  it("returns whole Unix seconds for currentTime/read", () => {
    expect(buildCurrentTimeReadResponse(1_750_000_000_999)).toEqual({ currentTimeAt: 1_750_000_000 });
  });
});
