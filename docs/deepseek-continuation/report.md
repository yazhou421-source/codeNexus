# DeepSeek Agent continuation 回归修复

日期：2026-09-07。工作目录：`/Users/huangyazhou/projects/ai-codex-desktop/app`。

修复已在本地源码完成，通过真实 Codex runtime 的 DeepSeek Pro/Flash 在线合成项目验证。未 commit、未 push，未替换 `/Applications/Calmnova Code.app`。本轮保留之前 In-App Update 的未提交改动。

## 1. 真实上游错误

不是由 UI 的 `INVALID_RESPONSE` 推断。先用合成 Chat continuation 取得原始 HTTP 错误，再用安装包内 Codex runtime、隔离 HOME/CODEX_HOME 和合成 `hello.py` 复现了相同的两次请求流程。

真实 Codex fixture 的错误：

```json
{
  "requestId": "req_uc88b7v2",
  "route": "deepseek-v4-flash",
  "status": 400,
  "code": "invalid_request_error",
  "type": "invalid_request_error",
  "param": null,
  "message": "The `reasoning_content` in the thinking mode must be passed back to the API."
}
```

证据：[Codex 修复前日志](validation/codex-before.jsonl)。第一个 `commandExecution` 成功，第二次请求失败；不是 loop guard 或 ceiling。

Pro 独立合成复现也得到同一条 400：`fixture_0e999a9d-f441-45e9-874f-fd57ee7e1537`。见 [Pro/Flash + Fast A/B](validation/upstream-commentary-before.jsonl)。这是本轮合成复现的请求 ID，不能冒充原截图那次请求 ID；旧安装版只有 console 日志，未找到可回查的文件记录。

## 2. 根因与修复

实际 Codex 第 2 次请求没有 `previous_response_id`，而是重放完整 Responses input：

`user → assistant message（说明文字）→ function_call → function_call_output`。

原转换存在两个缺口：

- streaming converter 丢弃 `delta.reasoning_content`，导致原生 assistant history 没有保留 reasoning。
- Responses 重放将同一次 Chat response 的说明文字与 tool calls 拆成两条 assistant。转换也不从 Router 已保存的原生记录恢复 reasoning。

DeepSeek 对带这条说明文字的 thinking continuation 拒绝请求。没有说明文字、只有工具调用的简化测试恰好成功，解释了以前简单的工具循环验证为什么没发现问题。

修复：保存流式 reasoning 增量；在 `response.completed` 发出前保存 native assistant/history；DeepSeek 重放时根据同 route、同 upstream model、精确 output 身份及内容匹配，恢复本 Router 生成的原生 assistant，将同一次响应的说明文字和 tool calls 还原到一起。不会随意合并相邻 assistant，也没有添加空 reasoning、关闭 thinking 或 catch 400 后删除随机字段重试。

这与 [DeepSeek thinking 工具调用要求](https://api-docs.deepseek.com/guides/thinking_mode/)一致。

边界：恢复使用现有的有界、进程内 Router history（200 entries、每条约 1 MB、总约 20 MB）。缓存淘汰或 Router 重启后不会猜测、伪造或跨 route 匹配旧 reasoning；旧会话跨重启恢复不属于本次在线验收范围。正常本轮 continuation 和 8 轮工作流已验证。

## 3. PR #3 对比

对比 `889f6b7 → 196a2af`：

- `responses-to-chat.js`、`chat-stream-to-responses.js`、`chat-to-responses.js`、`history.js` 的 Git blob ID 完全相同，见 [源文件身份记录](validation/pr3-source-identity.json)。
- 审查 `upstream.js`：成功路径仍用同一个 `messagesForHistory` 和 `assistantHistoryMessageFromChat(chat)` 保存 history；新增部分是 guard 计算、停止分支和 response metadata 内的 `toolGuardState`。
- `inspectToolContinuation()` / `stateWithAssistant()` 不修改传入 assistant、tool calls、工具结果或已有 guard state；新增无修改回归已覆盖。

因此，此复现的 reasoning 丢失及说明文字拆分问题在 PR #3 前已经存在。PR #3 不是本次根因。Tool Loop Guard exact repeat 和 hard ceiling 16 的既有测试继续通过。

## 4. 配对与上下文检查

- streaming 中上游 tool call ID 保持原值，重放后的 `tool_call_id` 完全一致。
- custom tool 仍以原来的 `{input: ...}` function wrapper 转换；恢复时使用原生 call，而非重复包装。
- function/command/custom 的 assistant tool calls 与紧随其后的 outputs 配对；并行输出全部紧随对应 assistant。
- 实际失败请求没有 previous ID；增量 previous-ID 的 8 轮测试中没有重复 tool output。
- `sanitizeMessagesForRoute` 没有删除 assistant；DeepSeek 允许保留 reasoning，其余 Chat 路由继续移除该字段。
- 正常配对经过 `normalizeToolCallPairs` 未产生孤立 tool message。缺配对时既有逻辑会退为文字上下文；本轮未改其策略。
- string tool output 不会二次 JSON stringify；330,000 字符的大输出逐字保留断言通过。
- 同一套 schema 在第 1 次请求已被接受；修复后真实 Codex 的 shell schema 连续成功，无 schema/tool_choice 导致该 400 的证据。

[DeepSeek 官方模型规格](https://api-docs.deepseek.com/quick_start/pricing)与当前 route 均为 1,000,000 context window。Router message trim 的预算为 650,000；原估算未计 reasoning，本次已加入，并另行报告 schema 与总输入估算。schema 计数用于诊断，目前 message trim 仍采用既有 65% 策略。

最终在线 synthetic fixture 的实际转换后计数：

| 模型 | 请求数 | 输入估算范围 | Schema 估算 | 最大累计 tool output |
|---|---:|---:|---:|---:|
| Flash | 9 | 5,608–6,854 | 4,624 | 1,232 bytes |
| Pro | 9 | 5,607–6,937 | 4,623 | 1,232 bytes |

这些是估算，不是精确 tokenizer 结果。原截图的 102.8k 不是本轮实际输入测量值；无真实项目上传授权时不能声称验证了那份请求。但同一个明确的 reasoning 400 能在小输入下复现，所以不能归因于 context overflow。

## 5. Fast / service tier

原 UI 仅依据全局 `fastModeEnabled` 显示“快速”，默认值为 true，没有检查当前模型 capability。这造成 DeepSeek 也显示 Fast。

现在 composer 与设置根据 model catalog 的 `serviceTiers` / `additionalSpeedTiers` 判断，未声明 Fast 的模型显示标准并禁用 Fast。切换到不支持 Fast 的 Router 模型时，thread/turn RPC 显式选用 default，清除继承的 priority；支持 Fast 的 GPT route 保持原行为。

Chat conversion 本来就使用字段白名单，没有将 `service_tier` 或 `speed` 传给 DeepSeek。修复前 Fast off / stale priority 的 A/B 请求哈希一致、都得到相同 reasoning 400；不带说明文字的对照则都为 200。Fast 是独立 UI/状态问题，不参与本次合成复现的 400。

## 6. 可访问的安全日志

新版 app 中路径：`~/Library/Application Support/Calmnova Code/logs/router-upstream.jsonl`。

记录 requestId、route、HTTP status、code/type/param、已核验安全的 provider message、消息 hash，以及请求大小/计数。0600 文件、0700 日志目录、约 256 KB 轮转且仅保留一份旧文件。sink 失败不会影响模型请求。

不记录 API key、Authorization、prompt、源码或用户文件正文。任意未知 provider message 可能回显正文，因而用 `[REDACTED]` 标记并保留 hash；本轮已确认的 DeepSeek 固定错误文本可原样保存。控制台 preview 也改用同一安全字段策略。未启用全量网络抓包。

## 7. 在线结果与回归

使用 `/Applications/Calmnova Code.app/Contents/Resources/codex/mac-arm64/bin/codex`，独立 HOME/CODEX_HOME、只读 sandbox、8 个本地纯合成文本文件。实际 runtime 调用 shell 工具，经本地修复 Router 请求官方 DeepSeek endpoint。

最终 Pro 与 Flash 均为：8 次 commandExecution、9 次请求、turn `completed`、最终答案正常。日志：[最终在线 8 轮](validation/codex-eight-rounds-final.jsonl)。普通输出及 reasoning 正文未写入日志。

回归覆盖：首次工具后的 continuation、8 轮后 final、streaming、custom、shell/command、parallel 配对、大输出、previous_response_id、完整 stateless history、Fast stale state、GPT/Codex Responses 原有透传测试、exact repeat、hard ceiling 16、replay 身份/缓存淘汰、脱敏 sink。并行配对使用 mock provider 验证；真实在线 8 轮按要求采用串行 shell。

真实项目验证：已请求用户明确授权，目前等待答复，尚未上传真实项目内容。

## 8. 修改文件与检查

本轮生产代码修改（相对上述工作目录）：

- `packages/router/src/chat-stream-to-responses.js`
- `packages/router/src/history.js`
- `packages/router/src/responses-to-chat.js`、`.d.ts`
- `packages/router/src/upstream.js`
- `packages/router/src/upstream-diagnostics.js`、`.d.ts`（新增）
- `packages/router/src/server.js`、`.d.ts`
- `packages/router/src/EmbeddedRouterManager.ts`
- `packages/app/src/main/main.ts`（与上一轮改动共存，仅新增日志接线）
- `packages/app/src/main/services/RouterDiagnosticLog.ts`（新增）
- `packages/app/src/main/codexAppServer.ts`
- `packages/app/src/main/codexRouterRuntime.ts`
- `packages/app/src/renderer/stores/modelCatalog.store.ts`
- `packages/app/src/renderer/components/layout/CenterPane.vue`
- `packages/app/src/renderer/components/layout/overlays/GlobalConfigDrawer.vue`

新增/更新测试：`deepseek-continuation.test.ts`、`server.test.ts`、`codexRouterRuntime.test.ts`、`RouterDiagnosticLog.test.ts`、`modelServiceTier.test.ts`。合成验收脚本：`packages/router/scripts/deepseek-continuation-live.mjs`、`deepseek-codex-live.mjs`、`packages/app/scripts/deepseek-continuation-entry.ts`。生产打包不引用这些脚本。

最终检查记录位于 `validation/`：

| 检查 | 结果 |
|---|---|
| `pnpm test` | 85 test files，646 tests，通过 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm format:check` | 通过 |
| `git diff --check` | 通过 |

与 build 等检查并行时，既有 provider-connection 的 localhost 关闭计时测试曾超时一次，其余 645 项通过；所有其他检查完成后独立重跑 `pnpm test`，646 项全部通过。未修改或放宽该计时测试，失败记录保留于 `validation/test-concurrent-timeout.log`。

未 commit，未 push。以上变更仍在当前工作区；原安装包未被替换。
