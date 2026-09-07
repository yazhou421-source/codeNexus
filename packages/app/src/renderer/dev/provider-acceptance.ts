// Standalone development harness. No preload, IPC, storage, credentials or provider requests.
import "../tailwind.css";
import "../styles/index.css";
import { createApp } from "vue";
import { i18n } from "../i18n";
import ProviderAcceptance from "./ProviderAcceptance.vue";
if (import.meta.env.DEV) createApp(ProviderAcceptance).use(i18n).mount("#app");
