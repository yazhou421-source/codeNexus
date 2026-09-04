/**
 * 模型选择器的共享目录。
 *
 * 内置模型作为默认候选，自定义模型只作为附加项进入列表，避免用户配置覆盖内置排序。
 */
export const BUILTIN_MODEL_IDS = [
  "gpt-5.5",
  "gpt-5.2",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
] as const;

export const DEFAULT_MODEL_NAME = BUILTIN_MODEL_IDS[0];

const BUILTIN_MODEL_ID_SET = new Set<string>(BUILTIN_MODEL_IDS);

/** 已下线的历史模型不再进入自定义模型列表，但旧线程仍可通过当前值回显。 */
const REMOVED_MODEL_ID_SET = new Set<string>(["gpt-5.2-codex"]);

export function normalizeModelId(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeModelIdList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of list) {
    const id = normalizeModelId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** 自定义模型列表只保留非内置、非下线且去重后的模型 ID。 */
export function normalizeCustomModelIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of list) {
    const id = normalizeModelId(item);
    if (
      !id ||
      REMOVED_MODEL_ID_SET.has(id) ||
      BUILTIN_MODEL_ID_SET.has(id) ||
      seen.has(id)
    )
      continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** 可选模型列表始终以内置模型开头，再追加有效自定义模型。 */
export function buildAvailableModelIds(
  customIds: readonly string[] | null | undefined,
  providerIds: readonly string[] | null | undefined = [],
): string[] {
  const ids: string[] = [...BUILTIN_MODEL_IDS];
  for (const item of [...normalizeModelIdList(providerIds), ...normalizeCustomModelIds(customIds ?? [])]) {
    if (!ids.includes(item)) ids.push(item);
  }
  return ids;
}

/** 当前模型即使不在候选列表里也会临时置顶，保证旧线程或外部模型能回显。 */
export function buildModelPickerOptions(args?: {
  customIds?: readonly string[] | null;
  providerIds?: readonly string[] | null;
  current?: unknown;
}): string[] {
  const available = buildAvailableModelIds(args?.customIds, args?.providerIds);
  const current = normalizeModelId(args?.current);
  if (!current) return available;
  if (available.includes(current)) return available;
  return [current, ...available];
}
