# DeepSeek 最终正文展示修复 · 1.0.4

附件说明：验收截图、本机日志及统计快照仅保留在本地，不随源码提交；下文保留验收结论和场景说明。

验收时间：2026-09-06 23:43 至 2026-09-07 00:04（UTC+8）。分支 `feat/codex-style-ui`。只修改消息展示分类，不改布局、Provider 路由、认证、模型配置、API Key 或更新能力。保留既有工作区改动；未 commit/push。

## A. 实际根因与字段证据

用户安装版的成功回合中，“用一句话介绍自己”的回复存在于 `item/agentMessage/delta`，但主聊天区只有默认折叠的“中间过程 / 活动 1”。只读检查该回合的已保存 assistant response_item，确认类型为 `message`、role 为 `assistant`、content 为 `output_text`，**没有 phase 字段**。正文已保存，不是模型没有回答。

新包独立验收会话也出现同一合法结构；紧随其后的 GPT-5.5 回合提供实机对照：

| 模型              | 实际持久化/协议结构                                                                             | 预期展示                         |
| ----------------- | ----------------------------------------------------------------------------------------------- | -------------------------------- |
| DeepSeek V4 Flash | `message / assistant / output_text`，phase 缺省；Renderer 事件为 `item/agentMessage/delta`      | 普通助手正文                     |
| GPT-5.5           | 独立 `reasoning`（1 项 summary），随后 `message / assistant / output_text / phase=final_answer` | reasoning 折叠，最终正文直接显示 |

沿现有代码追踪完整字段路径：`chat-stream-to-responses.js` 将 Chat Completions 的 `choices[0].delta.content` 转为 `response.output_text.delta`，完成时发 `response.output_text.done` / `response.output_item.done` / `response.completed`；message item 不写 phase。Codex 转为 `agentMessage`，Renderer 的 `installEventPipeline` 以 item ID 聚合增量并用完成正文替换，保留缺省 phase；历史 `replayParsers` 同样保留缺省值。reasoning 使用独立的 `item/reasoning/*`；工具使用各自执行事件。当前 Router 对 `reasoning_content` 的既有隔离没有改变，没有将它复制为 answer。

本轮没有抓取或保存含认证头的原始上游 SSE：上游字段映射来自实际使用的本地适配器代码；实测证据是安装版实际消息事件、对应回合的 response_item 字段和可见结果，不将代码推导冒充原始网络抓包。

错误发生在 **`useChatRenderModel.ts`**：`isIntermediateAgentMessageEvent` 把 `phase === ""` 与 `commentary` 等同；只有 `final_answer` 才能进入普通正文。生成协议 `MessagePhase.ts` 已明确 phase 不一定由 Provider 提供，缺省值需要兼容旧模型。

## B. 最小修复层级

修正所有 Provider 共用的 Renderer 消息展示适配层：明确的 `commentary` 仍是中间过程；`final_answer` 和缺省/null/空 phase 的普通 `agentMessage` 直接显示。reasoning、工具事件的分类、默认折叠和展开交互不变。

不为 DeepSeek 型号硬编码，也不让 Router 虚构 phase；没有拼接、复制或新增消息。正常完成保存、增量聚合、停止 journal 和历史格式均沿用原实现。已有无 phase 正文在历史重载后也获得相同展示修正。

## C. 修改文件

- 生产：`packages/app/src/renderer/components/layout/composables/useChatRenderModel.ts`，两处 phase 判断与说明注释。
- 回归：同目录 `useChatRenderModel.test.ts`。
- 记录：本文件、截图与 `docs/ui-review/DESKTOP-TRIAL.md` 的最新包索引。

## D. 回归测试与检查

新增 14 项实际 render model 测试，使用真实 Pinia timeline、历史回放和停止 journal，只有桌面 IPC 桥替换为空测试桩，不读用户配置。修复前 **10 失败 / 4 通过**，修复后 **14 全通过**：

- GPT reasoning + commentary/tool + final；DeepSeek Flash/Pro/R1 与 Kimi 共用无 phase 结构。
- reasoning-only、明确 commentary 不升格为答案，保持默认折叠。
- final-only 的显式、null、缺省、空 phase。
- 流式增量、完成替换和重复完成不会生成重复正文。
- 正常会话历史回放、主动停止后的正文与中断状态重载；迟到事件不能覆盖结果。

全量 **66 文件 / 498 测试通过**；格式、lint、typecheck、build、`git diff --check` 通过。最初测试类型检查发现可选 threadId 声明，补齐测试类型后检查通过，没有修改生产逻辑来绕过测试。

## E. 新 DMG 安装副本实机结果

从新 DMG 只读挂载并复制到本轮独立 `installed/Calmnova Code.app` 后启动；不是开发模式或浏览器预览。项目是独立空目录 `/private/tmp/calmnova-final-answer-check`。

| 检查                                                | 实际结果                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| DeepSeek V4 Flash，23:58:26，发送“用一句话介绍自己” | 通过：最终回答直接显示且仅一份。本回合没有可展示的 reasoning/tool，因此不出现空的中间过程卡片                      |
| GPT-5.5，00:00:14，简短数字问题                     | 通过：普通正文直接显示，思考默认收起；点击后显示其独立 summary，正文没有重复                                       |
| 正常退出、重新启动、打开验收历史                    | 通过：DeepSeek 与 GPT 正文各保留一份且直接显示；思考仍默认折叠                                                     |
| DeepSeek R1 / V4 Pro、Kimi 外部调用                 | 未额外调用；共用消息分类由回归覆盖，不冒充这些模型的实机验收                                                       |
| 主动停止后展示                                      | 本轮由真实 journal 写入/新 reader 重载 + render model 回归覆盖；未另发长模型任务，不声称新的实机中断或崩溃恢复验收 |

前置复现遇到两个客户端同时运行：`/Applications` 副本占用 15722，另一个副本退回原生 Codex 后报模型不支持。确认空闲后正常退出重复副本，修复包独占既有 Router 后两次真实调用成功；本轮未改路由，也未把该环境问题当作展示根因。

本地截图记录：DeepSeek 最终正文直接显示。

本地截图记录：GPT 最终正文与展开的中间过程。

本地截图记录：正常退出重启后的历史恢复。

安装包：`packages/app/release/answer-display-1.0.4-20260906/Calmnova-Code-1.0.4-arm64.dmg`。

- macOS arm64，版本仍为 **1.0.4**，appId / 产品名 / 用户数据目录不变。
- DMG 构建时间：2026-09-06 23:56:35 +0800，230153031 bytes。
- SHA-256：`ff98a9f99f420329a16131ad3e01a9a6272e7d550632c12e15e32dea0d95170d`。
- 同目录保留 ZIP；所有旧包和 /Applications 旧副本未覆盖。
- `codesign --verify --deep --strict` 通过；仍为本机 ad-hoc 签名候选包，未公证或公开发布，未关闭系统安全保护。

截图只保留本轮测试内容，无凭据、令牌、邮箱或其他会话内容。
