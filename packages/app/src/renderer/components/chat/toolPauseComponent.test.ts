import { build } from "esbuild";
import { parse, compileScript } from "@vue/compiler-sfc";
import { createRenderer, nextTick } from "vue";
import { createI18n } from "vue-i18n";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Compile the production SFC and exercise its real click handler using Vue's
// custom renderer. Only the app-runtime service boundary is replaced.
let directory: string;
let Component: any;
const calls: unknown[][] = [];
const callKey = "__calmnovaToolPauseComponentTest";
beforeAll(async () => {
  directory = await mkdtemp(resolve("packages/app/.tool-pause-component-"));
  const outfile = join(directory, "component.mjs");
  await build({
    entryPoints: [resolve("packages/app/src/renderer/components/chat/ChatAssistantMessage.vue")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    plugins: [
      {
        name: "vue-sfc",
        setup(builder) {
          builder.onResolve({ filter: /codexDesktopClient$/ }, () => ({ path: "desktop", namespace: "test-desktop" }));
          builder.onLoad({ filter: /.*/, namespace: "test-desktop" }, () => ({
            contents: "export const codexDesktop = { app: {}, localState: {} };",
          }));
          builder.onResolve({ filter: /runtimeOrchestrator$/ }, () => ({ path: "runtime", namespace: "test-runtime" }));
          builder.onLoad({ filter: /.*/, namespace: "test-runtime" }, () => ({
            contents: `export const getRuntimeOrchestrator = () => ({ continueToolPausedTurn: async (...args) => { globalThis.${callKey}(...args); return true; } });`,
          }));
          builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
            const source = await readFile(path, "utf8");
            const { descriptor } = parse(source, { filename: path });
            return {
              contents: compileScript(descriptor, { id: path, inlineTemplate: true }).content,
              loader: "ts",
              resolveDir: resolve(path, ".."),
            };
          });
        },
      },
    ],
  });
  (globalThis as any)[callKey] = (...args: unknown[]) => calls.push(args);
  Component = (await import(/* @vite-ignore */ pathToFileURL(outfile).href)).default;
});
afterAll(async () => {
  delete (globalThis as any)[callKey];
  if (directory) await rm(directory, { recursive: true, force: true });
});

type Node = { tag: string; text: string; props: Record<string, any>; children: Node[]; parent?: Node };
const node = (tag: string, text = ""): Node => ({ tag, text, props: {}, children: [] });
const renderer = createRenderer<Node, Node>({
  createElement: (tag) => node(tag),
  createText: (text) => node("text", text),
  createComment: (text) => node("comment", text),
  setText: (target, text) => {
    target.text = text;
  },
  setElementText: (target, text) => {
    target.text = text;
    target.children = [];
  },
  patchProp: (target, key, _old, value) => {
    target.props[key] = value;
  },
  parentNode: (target) => target.parent || null,
  nextSibling: () => null,
  insert: (target, parent) => {
    target.parent = parent;
    parent.children.push(target);
  },
  remove: (target) => {
    if (target.parent) target.parent.children = target.parent.children.filter((n) => n !== target);
  },
});
const flatten = (root: Node): Node[] => [root, ...root.children.flatMap(flatten)];

describe("production pause card", () => {
  it.each(["tool_loop_guard", "tool_limit_reached"])(
    "renders %s as warning and continues exactly once on click",
    async (reason) => {
      calls.length = 0;
      const stop = { reason, detail: "regression", rounds: 4, limit: 16 };
      const root = node("root");
      const app = renderer.createApp(Component, {
        event: {
          id: "pause",
          threadId: "same-thread",
          turnId: "same-turn",
          paramsText: `<!-- calmnova:tool-pause:v1 ${JSON.stringify(stop)} -->\n任务已暂停。`,
        },
        isStructuredFinalAnswer: false,
        markdownHtml: "",
        execState: null,
        modelOptions: [],
        isTurnRunning: false,
        reasoningEffortOptions: [],
        sandboxModeOptions: [],
      });
      app.use(createI18n({ legacy: false, locale: "zh-CN", messages: {} }));
      app.mount(root);
      const texts = () =>
        flatten(root)
          .map((n) => n.text)
          .join(" ");
      expect(texts()).toContain("任务已暂停");
      expect(texts()).not.toContain("执行完成");
      const button = flatten(root).find((n) => n.tag === "button" && n.text.includes("继续分析"))!;
      expect(button).toBeDefined();
      await button.props.onClick();
      await nextTick();
      expect(calls).toEqual([["same-thread", "pause"]]);
      expect(button.props.disabled).toBe(true);
      expect(texts()).toContain("已继续");
      await button.props.onClick();
      expect(calls).toHaveLength(1);
      app.unmount();
    }
  );
});
