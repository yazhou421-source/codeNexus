import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type { UiLanguage } from "@codenexus/shared/localSettings";
import zhCN from "./messages/zh-CN";
import enUS from "./messages/en-US";

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  lng: "zh-CN" as UiLanguage,
  fallbackLng: "zh-CN",
  interpolation: {
    escapeValue: false,
    prefix: "{",
    suffix: "}",
  },
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
  },
});

export function setUiI18nLanguage(language: UiLanguage): void {
  void i18n.changeLanguage(language);
  try {
    document.documentElement.lang = language;
  } catch {}
}
