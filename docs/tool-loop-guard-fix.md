# Embedded Router 工具循环保护修复

代码已修复；未 commit、未 push。修改限于 Chat Completions 续调保护、暂停呈现、继续操作及相应测试。原有未跟踪的设计/截图文件未改动。

## 根因与原算法

`upstream.js` 的默认 `DEFAULT_CHAT_TOOL_CONTINUATION_TURNS = 2`，在 `toolContinuationTurns > maxChatToolContinuationTurns(route)` 且上游继续返回可执行工具调用时，用本地回答替换模型响应。流式路径超过此阈值后还会改为非流式请求来执行同一判断。

这只是轮数判断，没有比较工具名、参数或结果。DeepSeek V4 Pro/Flash 未配置 override，故正常 `ls → find → read` 后的第 4 个工具被误杀。替代回答以普通 assistant 最终消息抵达 renderer；进度组件仅以“答案已开始”推断成功，显示“执行完成 · 结果如下”。

## 新算法

保护入口统一放在 Chat Completions 转换路径发出上游请求前。根据原始工具调用/结果建立指纹，兼容完整历史重发和 `previous_response_id` 增量历史，不依赖经截断或扁平化后的展示文本。

- Exact repeat：连续 3 个完成批次的工具名、规范化参数及输出相同。
- Short cycle：最近 4 个完成批次呈 A-B-A-B，A/B 各自的参数和输出均未变化。
- No progress：连续 4 个批次的工具名及有效输出相同，即使参数不同也会暂停。有效输出采用保守规则：至少 80 字符，或明确的失败/拒绝/错误信息；不同操作仅返回短 `OK` 不算无进展。
- 同一调用持续得到新结果时继续，例如有进展的轮询。
- JSON 参数递归排序对象键，保留数组顺序与字符串内的有效空白；输出仅去除已知 shell 包装层耗时、chunk ID 等元信息，保留实际内容、退出状态及内容中的数字。
- 并行工具结果算一个 continuation round，完整批次的结果收齐后才用于语义判断。
- 只保存最近 6 个批次的指纹和待返回调用的标识；原始工具结果仍由既有 ResponseHistory 保存。新用户消息重置本轮计数和检测窗口，历史上下文保留。

这里的 semantic detection 是可审查的进展启发式，未用嵌入模型进行模糊文本相似度判定，以减少正常探索误判。

## 绝对上限

默认 **16 个工具结果 continuation rounds**。8 轮项目探索回归是本次评估基线；16 为后续补充读取/验证留出一倍余量，同时限制单次自主执行。不是给 DeepSeek 无限 continuation，也不是任意采用 12。

收到第 16 轮结果后，无条件暂停，不再发出下一个上游请求。即使无法配对某个工具结果，绝对上限仍统计该结果批次。语义检测不以调用轮数替代重复证据。

配置优先级：

1. route `maxToolContinuationTurns` / `max_tool_continuation_turns`
2. config `providerToolContinuationLimits[providerId]`
3. config `maxToolContinuationTurns`
4. 默认 16

覆盖值必须有限且至少为 1；零、负数、Infinity、NaN 回退到默认，不允许关闭安全上限。Responses routes 原样返回，不注入这些 Chat 专用默认值。

## 暂停与继续

Router 暴露 `stop_reason` 和 `metadata.stop_reason`：`tool_loop_guard` 或 `tool_limit_reached`，并在历史元信息中保存原因与检测状态。

Codex app-server 不会把自定义 Response metadata 直接转发给 renderer，因此用版本化 assistant 文本 envelope 携带同一结构化暂停信息，保证持久化/历史重放仍可恢复。保留协议层 `response.completed` 来表示这次模型响应传输结束；它不再被 UI 当作任务成功。真实 bundled app-server 集成测试覆盖了此传递过程。

Renderer：

- 任务进度状态为 `paused`，呈现 warning 和“任务已暂停”。
- 回答位置显示中文暂停卡片、已保留最新结果说明、“继续分析”按钮及折叠技术详情。
- 不把 CodexBridge 英文诊断作为最终回答主体；旧历史里的英文 guard 消息也映射为暂停。
- “继续分析”通过已有发送链路向同一任务发送续做指令：从最新结果继续、保留原任务与只读约束、避免重复检查和从 pwd/ls 重启探索。
- 不回滚、不新建任务、不清空 composer 草稿。运行中、连续点击、切换任务、旧暂停事件等均有防护；发送失败可重试。

## 自动回归结果

最终 `pnpm run test`：**80 个测试文件，601 项通过**。

`pnpm run lint`、`pnpm run typecheck`、`pnpm run build`、`git diff --check` 全部通过。

覆盖：

- 3 个不同调用后仍允许第 4 个工具；JSON/SSE 均验证。
- 完整 8 轮增量读取及最终回答；JSON 和原生 Chat SSE 均验证。
- 同工具/同参数/同输出的连续重复，A-B-A-B，无进展错误循环。
- 参数键顺序规范化、shell 耗时包装、状态/内容变化、短通用成功响应及并行批次。
- 默认硬上限、route/provider/global override、不能用无效配置禁用保护。
- 停止前不额外请求上游，最新结果和原任务仍在上下文，继续后可完成分析。
- 实际生产 Vue SFC 的暂停卡片及 click handler：两个 stop reason 均为 warning，携带同一任务 ID 继续，成功后按钮禁用。
- 真实 bundled Codex app-server + 本机模拟 DeepSeek 上游：3 次重复调用暂停，随后同一 thread 继续，工具结果保留且不重复执行。
- 原有 GPT/Codex Responses、provider switching、流中断和取消等全量测试通过。

浏览器对临时 localhost 预览返回 `ERR_BLOCKED_BY_CLIENT`，因此不声称完成截图级视觉验收；实际 Vue 组件渲染和按钮行为由上述自动测试验证。

## DeepSeek 在线验证

真实在线测试使用本地生成的虚构阅读清单项目，模型自行发出工具调用；调用由只读命令执行，然后经 Embedded Router 的原生 SSE / `previous_response_id` 链路续调。没有发送用户的实际源码。

检查序列为 `ls → find → package.json → README → frontend entry → backend entry → search routes → feature listing → final answer`。每个模型要求 8 个独立工具轮次；使用默认硬上限 16，无特殊放宽。

2026-09-07 在线结果：

| 模型 | 独立工具轮次 | 最终响应 | guard |
| --- | --- | --- | --- |
| DeepSeek V4 Pro | 8 | 已返回 | 未触发 |
| DeepSeek V4 Flash | 8 | 已返回 | 未触发 |

每个模型共 9 次真实上游请求：8 次工具选择及 1 次最终响应。摘要见 `tool-loop-guard-validation/deepseek-live-summary.json`。

可复用测试脚本为 `packages/router/scripts/verify-tool-continuation-live.mjs`。常规运行从本机 `DEEPSEEK_API_KEY` 环境读取凭据，仅发送脚本生成的示例项目；不输出或写出凭据。

自动审批曾拒绝发送当前项目真实源码到 DeepSeek，理由是未明确授权相关私有内容出站；已改用无私有内容的测试项目完成验证范围。直接针对当前真实项目的在线分析不在本次已验证范围内。
