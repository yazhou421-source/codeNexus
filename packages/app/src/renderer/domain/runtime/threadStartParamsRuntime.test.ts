import { describe, expect, it } from "vitest";
import { IMAGE_GENERATION_DYNAMIC_TOOL_NAME } from "@codenexus/shared/dynamicTools";
import { createThreadStartParamsRuntime } from "./threadStartParamsRuntime";

describe("threadStartParamsRuntime prompt injection", () => {
  it("registers profile tools without duplicating turn-level developer instructions", () => {
    const runtime = createThreadStartParamsRuntime({
      getMainView: () => "chat",
      getPaperMode: () => "draft",
      getApprovalPolicy: () => "never",
      getApprovalsReviewer: () => null,
      normalizeWorkspacePath: (value) => value,
    });

    const { params } = runtime.buildThreadStartParamsForModel({
      model: "deepseek-v4-flash",
      workspace: "/tmp/synthetic-workspace",
      sandboxMode: "read-only",
    });

    expect(params.dynamicTools).toEqual([expect.objectContaining({ name: IMAGE_GENERATION_DYNAMIC_TOOL_NAME })]);
    expect(params).not.toHaveProperty("developerInstructions");
  });
});
