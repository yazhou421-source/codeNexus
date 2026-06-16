import { i18n } from ".";

export function translate(key: string, params?: Record<string, unknown>): string {
  return i18n.t(key, params);
}
