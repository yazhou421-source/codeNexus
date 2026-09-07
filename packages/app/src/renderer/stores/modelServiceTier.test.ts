import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useModelCatalogStore } from "./modelCatalog.store";
vi.mock("../api/codexDesktopClient", () => ({ codexDesktop: { localState: {} } }));
beforeEach(() => setActivePinia(createPinia()));
it("enables Fast only for advertised capability, including after GPT to DeepSeek switch", () => {
  const catalog = useModelCatalogStore();
  catalog.remoteModels = [
    { model: "gpt-fast", serviceTiers: [{ id: "priority" }], additionalSpeedTiers: [] },
    { model: "deepseek-v4-pro", serviceTiers: [], additionalSpeedTiers: [] },
    { model: "deepseek-v4-flash", serviceTiers: [], additionalSpeedTiers: [] },
  ] as any;
  expect(catalog.supportsFast("gpt-fast")).toBe(true);
  expect(catalog.supportsFast("deepseek-v4-pro")).toBe(false);
  expect(catalog.supportsFast("deepseek-v4-flash")).toBe(false);
  expect(catalog.supportsFast("uncatalogued-model")).toBe(false);
});
