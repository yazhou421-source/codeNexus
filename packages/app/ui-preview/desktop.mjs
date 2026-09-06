// Test-only boundary. No preload, filesystem, network, credentials, or real runtime.
import { DEFAULT_USER_LOCAL_SETTINGS, normalizeUserLocalSettings } from "../src/common/localSettings";
let settings = structuredClone(DEFAULT_USER_LOCAL_SETTINGS);
const noop = () => {};
const api = (path = "") =>
  new Proxy(noop, {
    get: (_, key) => {
      if (key === "then" || String(key).startsWith("initial")) return undefined;
      if (key === Symbol.toPrimitive) return () => "";
      return api(`${path}.${String(key)}`);
    },
    apply: (_, _this, args) => {
      if (path === ".localState.patchSettings") {
        settings = normalizeUserLocalSettings({ ...settings, ...args[0] });
        return Promise.resolve({ path: "", exists: false, settings });
      }
      if (path === ".app.getUpdateState") return Promise.resolve({ status: "idle" });
      if (/\.on[A-Z]/.test(path)) return noop;
      if (path === ".window.getState")
        return Promise.resolve({ isMaximized: false, isMinimized: false, isFullScreen: false });
      if (path === ".app.listNotificationSounds") return Promise.resolve([]);
      return Promise.reject(new Error(`UI preview: desktop operation unavailable (${path})`));
    },
  });
export const codexDesktop = api();
window.codexDesktop = codexDesktop;
