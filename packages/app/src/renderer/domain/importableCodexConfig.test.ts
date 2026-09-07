import { describe, expect, it } from "vitest";
import { importableCodexConfig } from "./importableCodexConfig";

describe("settings auto-import configuration provenance", () => {
  it("P0-6 reads only the persisted user layer, never the Router merged view or session flags", () => {
    const user = { model_provider: "mine", model: "custom" };
    expect(
      importableCodexConfig({
        layers: [
          {
            name: { type: "user", file: "/home/config.toml", profile: null },
            version: "1",
            disabledReason: null,
            config: user,
          },
          {
            name: { type: "sessionFlags" },
            version: "2",
            disabledReason: null,
            config: { model_provider: "codenexus-router-codex" },
          },
        ],
      })
    ).toEqual(user);
  });
  it("never falls back to the effective view when layers are unavailable", () => {
    expect(importableCodexConfig({ layers: null })).toBeNull();
  });
  it("rejects legacy pollution even if it is already in the user layer", () => {
    expect(
      importableCodexConfig({
        layers: [
          {
            name: { type: "user", file: "/home/config.toml", profile: null },
            version: "1",
            disabledReason: null,
            config: { model_provider: "codenexus-router-codex" },
          },
        ],
      })
    ).toBeNull();
  });
});
