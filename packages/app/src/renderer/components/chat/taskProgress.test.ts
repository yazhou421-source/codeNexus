import { describe, expect, it } from "vitest";
import { buildTaskProgress } from "./taskProgress";
import type { ChatAuxiliaryRow } from "../layout/types/chat.types";
const command = (status: string, commandShort = "cat packages/app/package.json") =>
  ({
    id: "command-1",
    turnKey: "turn:1",
    kind: "commandSession",
    item: { status, commandShort, durationMs: 250 },
  }) as ChatAuxiliaryRow;
describe("task progress truthfulness", () => {
  it("describes an observed file read without promoting the raw command", () => {
    expect(buildTaskProgress([command("completed")], true, true)[0]).toMatchObject({
      title: "读取 package.json",
      state: "success",
      durationMs: 250,
    });
  });
  it("does not mark unknown or stopped operations successful", () => {
    for (const status of ["unknown", "running", "inProgress"])
      expect(buildTaskProgress([command(status)], false, false)[0].state).toBe("idle");
  });
  it("preserves failure, refusal and approval states", () => {
    expect(buildTaskProgress([command("failed")], false, true)[0].state).toBe("error");
    for (const status of ["declined", "cancelled", "awaitingApproval"])
      expect(buildTaskProgress([command(status)], true, true)[0].state).toBe("warning");
  });
  it("does not invent completed steps for empty activity", () => {
    expect(buildTaskProgress([], true, true)).toEqual([]);
  });
  it("summarizes sliced reads and retains a generic label for compound commands", () => {
    expect(buildTaskProgress([command("completed", "sed -n '1,80p' src/App.vue")], true, false)[0].title).toBe(
      "Read App.vue"
    );
    expect(buildTaskProgress([command("running", "cat a && rm b")], true, false)[0].title).toBe("Run command · cat");
  });
});
