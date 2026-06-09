/**
 * Runnable demo: drives agent kernel with a real model to complete tasks using file and command tools.
 *
 * This is the "ignition" entry point that brings together:
 *   ChatCompletionsClient (real model) + fileTools + commandTools + runAgent + command-line task
 *
 * Commands are one-shot only via run_command (waits for completion).
 * Process management tools have been removed.
 *
 * Usage (key from environment variable, not committed to repo):
 *   AGENT_API_KEY=sk-xxx pnpm --filter @codenexus/agent-core demo "list src, read package.json version, run node -v"
 *
 * Optional environment variables:
 *   AGENT_BASE_URL   default https://newapi.huiqing.cyou/v1
 *   AGENT_MODEL      default gpt-5.5
 *   AGENT_ROOT       tool sandbox root directory, defaults to current working directory
 */

import { runAgent } from "./runAgent";
import { createChatCompletionsClient } from "./chatCompletionsClient";
import { createFileTools } from "./fileTools";
import { createCommandTools } from "./commandTools";
import type { AgentEvent, AgentMessage } from "./types";

const DEFAULT_BASE_URL = "https://newapi.huiqing.cyou/v1";
const DEFAULT_MODEL = "gpt-5.5";

const SYSTEM_PROMPT = [
  "You are a coding assistant operating inside a local workspace.",
  "You can read, list, write and edit files, and run shell commands using the provided tools.",
  "Use run_command for commands (e.g. node -v, git status, npm test).",
  "Use tools to gather facts before answering; do not guess file contents.",
  "When the task is complete, reply with a concise final answer (no tool call).",
].join(" ");

function logEvent(event: AgentEvent): void {
  switch (event.type) {
    case "assistant_message":
      console.log(`\n[assistant] ${event.content}`);
      break;
    case "tool_call":
      console.log(`[tool→] ${event.call.name}(${event.call.arguments})`);
      break;
    case "tool_result": {
      const preview = event.result.length > 200 ? `${event.result.slice(0, 200)}…` : event.result;
      console.log(`[tool←] ${event.name}: ${preview.replace(/\n/g, "\\n")}`);
      break;
    }
    case "tool_error":
      console.log(`[tool✗] ${event.name}: ${event.error}`);
      break;
    case "max_steps_reached":
      console.log(`[!] reached max steps (${event.steps})`);
      break;
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.AGENT_API_KEY?.trim();
  if (!apiKey) {
    console.error("Missing AGENT_API_KEY environment variable.");
    process.exit(1);
  }

  const task =
    process.argv.slice(2).join(" ").trim() ||
    "List the workspace root, then read package.json and tell me its name and version.";

  const baseUrl = process.env.AGENT_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const model = process.env.AGENT_MODEL?.trim() || DEFAULT_MODEL;
  const rootDir = process.env.AGENT_ROOT?.trim() || process.cwd();

  console.log(`base : ${baseUrl}`);
  console.log(`model: ${model}`);
  console.log(`root : ${rootDir}`);
  console.log(`task : ${task}\n`);

  const client = createChatCompletionsClient({ baseUrl, apiKey, model });
  const tools = [...createFileTools(rootDir), ...createCommandTools({ cwd: rootDir })];
  const messages: AgentMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: task },
  ];

  const result = await runAgent({ client, tools, messages, maxSteps: 12, onEvent: logEvent });

  console.log("\n──────── result ────────");
  console.log(`steps           : ${result.steps}`);
  console.log(`stoppedByMaxStep: ${result.stoppedByMaxSteps}`);
  console.log(`final answer    :\n${result.finalText}`);
}

main().catch((error: unknown) => {
  console.error("\n[demo failed]", error instanceof Error ? error.message : error);
  process.exit(1);
});
