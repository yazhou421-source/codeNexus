import { useRuntimeStore } from "../src/renderer/stores/runtime.store";
const runtime = new Proxy(
  {},
  {
    get:
      (_, key) =>
      async (...args) => {
        if (key === "createThread") useRuntimeStore().currentThreadId = "";
        if (key === "switchThread") useRuntimeStore().currentThreadId = args[0];
      },
  }
);
export const getRuntimeOrchestrator = () => runtime;
