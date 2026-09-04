import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_NAME, buildModelPickerOptions } from "./modelCatalog";

describe("provider model picker catalog", () => {
  it("adds available Provider models without duplicating built-in or custom models", () => {
    const result = buildModelPickerOptions({
      providerIds: ["deepseek-v4-pro", DEFAULT_MODEL_NAME, "deepseek-v4-pro"],
      customIds: ["custom-model", "deepseek-v4-pro"],
    });

    expect(result.filter((id) => id === "deepseek-v4-pro")).toHaveLength(1);
    expect(result).toContain("custom-model");
  });

  it("keeps an unavailable historical model visible as the current value", () => {
    const result = buildModelPickerOptions({ providerIds: [], current: "deepseek-v4-pro" });

    expect(result[0]).toBe("deepseek-v4-pro");
  });

  it("does not add an unavailable Provider model unless it is the historical current value", () => {
    expect(buildModelPickerOptions({ providerIds: [] })).not.toContain("deepseek-v4-pro");
    expect(buildModelPickerOptions({ providerIds: [], current: "deepseek-v4-pro" })).toContain("deepseek-v4-pro");
  });
});
