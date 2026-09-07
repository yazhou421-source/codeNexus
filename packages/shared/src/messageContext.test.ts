import { describe, expect, it } from "vitest";
import {
  isMessageContextOnly,
  stripLeadingMessageContext,
} from "./messageContext";

describe("message context presentation", () => {
  const context =
    "<recommended_plugins>plugin list</recommended_plugins>\n<environment_context>cwd</environment_context>";
  it("recognizes a complete context-only message for collapsible display", () => {
    expect(isMessageContextOnly(context)).toBe(true);
  });
  it("keeps a real task after bootstrap blocks", () => {
    expect(stripLeadingMessageContext(context + "\n修复停止后的历史恢复")).toBe(
      "修复停止后的历史恢复",
    );
    expect(isMessageContextOnly(context + "\n修复停止后的历史恢复")).toBe(
      false,
    );
  });
  it("does not remove tags quoted inside a task", () => {
    const task = "解释这段文本：" + context;
    expect(stripLeadingMessageContext(task)).toBe(task);
    expect(isMessageContextOnly(task)).toBe(false);
  });
  it("keeps incomplete context blocks visible", () => {
    const task = "<recommended_plugins>incomplete";
    expect(stripLeadingMessageContext(task)).toBe(task);
    expect(isMessageContextOnly(task)).toBe(false);
  });
});
