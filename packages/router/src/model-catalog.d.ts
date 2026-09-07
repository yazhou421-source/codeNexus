import type { RouterConfig, RouterModelRoute } from "./types";

export type RouterModelCatalogEntry = Record<string, unknown> & {
  slug: string;
  display_name: string;
};

export type RouterModelCatalog = {
  models: RouterModelCatalogEntry[];
};

export function buildModelCatalog(config: RouterConfig): RouterModelCatalog;
export function modelCatalogEntry(
  model: RouterModelRoute,
  defaults?: Record<string, unknown>,
  index?: number,
): RouterModelCatalogEntry;
export function openAiModelsList(config: RouterConfig): {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
    created: number;
    owned_by: string;
  }>;
};
