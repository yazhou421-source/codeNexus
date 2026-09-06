# 1.0.4 安装版 Codex 模型启动加载回归

附件说明：验收截图、本机日志及统计快照仅保留在本地，不随源码提交；下文保留验收结论和场景说明。

核查日期：2026-09-07（Asia/Shanghai）。本轮未修改 UI 布局、Provider 配置、认证凭据、更新功能；没有 commit / push。

## 原始证据与调用链

- `/Applications/Calmnova Code.app` 的 `app.asar` SHA-256 与上次 r2 验收副本一致：`e864062644b4390ad4ecb64b0659163c92668686f0514641617079f10d7a7a30`。不是装错旧版本。
- 安装版启动页实际显示 **ChatGPT/Codex 已登录**；当前用户对 `~/.codex/auth.json` 的可读性检查通过，没有输出文件内容。认证服务和模型发现均沿用 Codex 的现有凭据解析。
- **未选择工作区时**：菜单仅有 DeepSeek/Qwen 和禁用的历史 GPT-5.5。`ensureRemoteModels/refreshRemoteModels` 在 `runtimeStore.serverId` 为空时执行 reset 并返回，根本不发送 model/list。因此此分支没有 RPC 返回、HTTP 状态或服务端模型数量；Renderer 的空数组不等于服务端返回 0 项。
- **同一安装版选择空验收目录后**：不改配置、不重新登录，7 个 Codex 选项立即恢复：`gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`、`gpt-5.4-mini`、`gpt-5.3-codex-spark`。上次成功验收也先连接了目录，因而漏测启动页。
- 上次成功路径：选择工作区 → 聊天 serverId → CenterPane watcher → 通用 codex:rpc model/list → CodexServerManager 拦截 → 独立 CodexModelCatalogService → account/read → model/list → Router 注册同步 → Renderer。
- 失败路径：启动 → 独立认证检查成功 → 无聊天 serverId → 模型 store 提前返回；认证从 unknown/checking 变成 logged_in 没有模型刷新监听。并非模型目录早于 auth 初始化后产生了一次 403，而是查询触发条件错误。
- 旧设置中的模型手动刷新也被 serverId 条件禁用；选择工作区后已有查询可恢复。本轮通过代码核对该禁用条件，未人为制造认证失败。

本地截图记录：旧安装版：已登录但启动页缺少模型。

本地截图记录：同一旧安装版：选择目录即恢复。

## 缓存与恢复问题

旧 store 初始为空、无 serverId 时重置为空、RPC 失败时也清空 `remoteIds`；这是 Renderer 内存状态，没有将该空结果持久化为用户模型禁用配置。模型不可用标签由列表缺席即时推导，没有单独的永久禁用记录。旧代码存在焦点/手动重试，但没有定时重试或登录恢复联动。因而断网后的缺失也会持续到下一个有效触发。

本轮不恢复静态模型白名单，也不引入跨账户的持久化目录缓存。只有成功目录能替换最近成功的模型集合，暂时失败保留现有集合；未得到可靠目录时，不把历史当前值推定为已失去权限。成功目录明确缺席以及已确认未登录/失效仍禁用相关项。

## 最小修复

- 账户目录使用独立、无参数的 `codex:listAccountModels` IPC，不需要创建工作区或放宽通用 RPC 的 serverId 校验。复用现有独立发现、Router 同步逻辑，不改 DeepSeek/Qwen 路径。
- 登录状态恢复到 logged_in 自动刷新；退出登录/失效清理账户目录并使迟到的旧请求结果失效。
- 临时失败保留最近成功目录，标记 error，通过现有 toast/设置错误区域提示可重试；2/4/8 秒最多三次自动重试，手动与窗口焦点刷新仍可用。
- 设置远程模型刷新解除工作区依赖；只修改相关可用性和事件逻辑，不改布局或样式。
- 主进程只记录账户类型、RPC 阶段、成功模型数量/ID；不记录账户邮箱、令牌或请求正文。底层是 stdio JSON-RPC，不能把 RPC 成功虚构为 HTTP 200。

修改文件：

- `packages/shared/src/ipc/channels/codex.ts`、`packages/shared/src/ipc/contracts.ts`
- `packages/app/src/preload/api/client/codexServer.ts`
- `packages/app/src/main/ipc/handlers/codex.handlers.ts`、`codex-models.handlers.test.ts`
- `packages/app/src/main/services/CodexServerManager.ts`、`CodexModelCatalogService.ts`
- `packages/app/src/renderer/stores/modelCatalog.store.ts`、`modelCatalog.store.test.ts`
- `packages/app/src/renderer/components/layout/CenterPane.vue`、`overlays/GlobalConfigDrawer.vue`（脚本逻辑）
- `packages/app/src/renderer/i18n/messages/zh-CN.ts`（现有错误提示文案）

## 回归测试

未连接工作区也应加载、临时失败应保留成功目录：两项断言在本轮修复前实际失败，修复后通过。并覆盖隐藏/未返回型号、workspace 切换不影响账户目录、unknown → logged_in、登录恢复、迟到结果、有限重试、手动重试、成功目录剔除型号与不完整结果不覆盖缓存。

新增 IPC 测试验证不创建/查找工作区 server 即可获取目录，失败向上传播，不返回虚假空成功。

全量 **69 文件 / 517 项测试通过**；格式、lint、typecheck、build、git diff --check 通过。第一次全量测试因沙箱禁止 127.0.0.1 监听失败，获准在沙箱外运行后全部通过；未改断言绕过失败。

## 新安装副本

- 从新 DMG 只读挂载并复制到独立 installed 目录，codesign 深度校验通过，真实 Electron 启动。
- 未选择工作区时已登录，model/list 实际发出并成功返回 7 项，包含 Astra、6 个 GPT-5.x；脱敏日志已核对该结果，日志仅保留在本地。
- 选择 `gpt-6-astra` / low，连接独立空验收目录后发送 `hi`，真实返回 **“Hi! What can I help you with today?”**，任务结束。仅发起这一条模型请求；只核对本轮验收会话的 `turn_context` 元数据，实际 `model=gpt-6-astra`、`effort=low`，随后有 `task_complete`，没有读取其他历史正文。
- 正常 Cmd+Q 退出并重新启动同一安装副本；无工作区启动页仍显示已登录，model/list 再次成功返回 7 项，Astra 与 GPT-5.x 选项正常，历史 GPT-5.5 不再误标不可用。
- 设置 → 通用 → 自定义模型旁的“刷新”在未选择工作区时可点击；实际点击后新增一次 model/list 成功日志，仍显示“已读取 7 个可用模型”。
- **未做实机故障注入**：真实断网后的自动重试、退出登录再登录恢复由回归测试覆盖，未更改真实认证凭据去模拟这些状态。不能把自动化测试描述为实机故障恢复已验证。

本地截图记录：新安装版：无工作区自动加载。

本地截图记录：Astra 一次真实调用回复。

本地截图记录：正常退出重启后模型仍正常。

本地截图记录：设置手动刷新：未连接工作区也可加载 7 项。

平台/版本：macOS arm64 / **1.0.4** 本机候选版，ad-hoc 签名，未公证、未发布，未关闭系统安全保护。

DMG：`packages/app/release/model-startup-1.0.4-20260907/Calmnova-Code-1.0.4-arm64.dmg`

构建文件时间：2026-09-07 00:47:58 +0800。

SHA-256：`471a835ed91e5138541097349efd181f2ea509048317cc66a7749cd135eb4d81`

安装副本：同输出目录 `installed/Calmnova Code.app`。旧包及 `/Applications` 副本未覆盖。

当前分支：`feat/codex-style-ui`。工作区有本轮及此前未提交修改/新增文件，保留原有删除项；未 reset、clean、commit、push。当时的 Git 状态快照仅保留在本地。
