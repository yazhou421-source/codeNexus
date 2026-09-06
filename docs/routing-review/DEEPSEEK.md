# DeepSeek 路由修复 · 1.0.3

附件说明：验收截图、本机日志及统计快照仅保留在本地，不随源码提交；下文保留验收结论和场景说明。

2026-09-06，分支 feat/codex-style-ui。本轮开始时仓库已有 UI、历史与打包改动，全部保留；本轮不改 UI、不 commit/push。

## 修改前只读调用链

| 链路                           | Provider / 模型                                                                   | 认证                                        | 入口与上游                                                                                                                            | Adapter                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 设置 DeepSeek 测试连接         | deepseek / deepseek-v4-pro（注册表默认模型）                                      | api_key，主进程 SecretStore 解密            | ProviderRuntimeService.testConnection → 注册表现有 https://api.deepseek.com/v1/chat/completions；不经过 app-server 或 loopback Router | testProviderConnection → responsesToChatRequest → callJsonUpstream，非流式 |
| Composer DeepSeek 聊天（预期） | deepseek / 所选 deepseek-v4-flash；pro 保持同 ID，r1 上游 ID 为 deepseek-reasoner | api_key；app-server 仅持有本地 Router token | codenexus-router → http://127.0.0.1:15722/v1/responses → 注册表 DeepSeek /chat/completions                                            | Responses → Chat Completions → Chat SSE 转 Responses SSE                   |
| GPT-5.5 聊天                   | Codex 订阅路由 / gpt-5.5                                                          | codex_openai，既有登录认证                  | codenexus-router-codex → http://127.0.0.1:15722/codex-auth/v1/responses → https://chatgpt.com/backend-api/codex/responses             | Responses 转发                                                             |

设置组件 → providerRegistry.store.testConnection(providerId) → preload app.testRouterProviderConnection → provider.handlers → ProviderRuntimeService → 同一 BUILTIN_PROVIDER_REGISTRY。key 不返回 Renderer。

ComposerModelReasoningPicker 发出 model ID → ComposerPanel 透传 → runtime compose 状态 → threadCreationRuntime/threadStartParamsRuntime → thread/start；turnStartRuntime 同时携带顶层 model 和 collaborationMode.settings.model → preload codexServer.rpc → CodexServerManager → CodexAppServer.request。

Renderer/协议使用唯一 model ID，不携带凭据。主进程由 EmbeddedRouterManager.ownedConnection.routes 的显式 authMode 建立 localTokenModelIds，非模型名字猜测。ProviderRuntimeService 与 Router 的注册表仍保留 provider=deepseek、authMode=api_key、apiKeyRef=deepseek；Kimi 同理。

## 修改前证据与根因

- /Applications/Calmnova Code.app 的真实界面存在 GPT 成功回复，随后 DeepSeek V4 Flash 的错误指向 /codex-auth/v1/responses，并显示原始 403 信息。与用户报告一致。
- 对当前打包的 Codex 0.153.2 做隔离临时目录协议探测（不读用户凭据、不访问真实模型）：thread/start 正确接收 modelProvider；已有会话 thread/resume 切换 Provider 后仍返回原 Provider。空闲会话 unsubscribe 后再 resume 才返回新 Provider；resume 内部完成 shutdown/flush/reload，不应等待 loaded/list 自行清空。
- CodexAppServer.ensureRouterProviderForTurn 原来仅 await thread/resume，未核对返回值；turn/start 协议可覆盖 model，却没有 modelProvider 字段。错误在主进程适配 app-server 的会话重绑流程产生，Router 的 403 是正确的认证边界拦截。
- 旧单测用模拟服务直接回显请求的 modelProvider，没有模拟已加载会话忽略覆盖的行为。
- 官方同版本源码佐证：[thread processor](https://raw.githubusercontent.com/openai/codex/rust-v0.153.2/codex-rs/app-server/src/request_processors/thread_processor.rs)；本地 generated ThreadResumeParams 也明确区分已加载会话的 rejoin 与磁盘恢复。
- 复现期间发现 /Applications 副本已占有 15722；另开旧包副本会退回原生 Codex 并报不支持 DeepSeek（400）。已退出额外副本，此现象单独记录，不与用户 403 根因混淆。

## 最小修复

只修改生产文件 `packages/app/src/main/codexAppServer.ts` 的 ensureRouterProviderForTurn：先核对 resume 实际返回的 modelProvider。原 Provider 不匹配时拒绝干预 active turn；unsubscribe 后由 app-server 的 resume 在内部完成空闲会话 shutdown、flush 和同 ID 历史恢复，再核对 Provider。为吸收 turn/completed 后 core 尚未 idle 的时间差，最多进行 3 次本地重绑，等待 50/100/200ms；不重试、不额外发送任何模型请求。不能成功切换时直接返回明确错误，保留原始 Router 403 防护。

不改 providerRegistry、base URL、API Key、Router 授权边界、responses adapter、Renderer 或持久化格式。不创建替代会话，不伪装模型。API-key 模型从显式 route.authMode 解析；新测试也用名字以 gpt 开头的 API-key 路由验证不是名称猜测。

## 回归与构建

- 新增 codexProviderSwitch.test.ts：10 项。修复前 9 失败 / 1 通过；修复后全通过。覆盖 GPT、DeepSeek pro/flash/r1、Kimi、GPT→DeepSeek→GPT、运行中禁止重绑、unsubscribe 失败不发送、重绑未生效不发送及最多 3 次限制。
- 新增 codexProviderSwitch.integration.test.ts：使用实际 bundled Codex 0.153.2、临时目录、虚构认证和 loopback SSE，验证 4 个真实 app-server 请求的 URL、model 和认证头以及回合完成。GPT→DeepSeek→Kimi→GPT 分别落到 codex-auth / API-key / API-key / codex-auth。不是外部模型调用；不读取用户配置。
- 全量测试 63 文件 / 462 项通过。格式、lint、typecheck、pnpm run build、git diff --check 通过。原有有效断言未删除。

## 新 DMG 安装副本实机验收

- macOS arm64，Calmnova Code 1.0.3；appId 和用户数据目录不变。
- DMG：`packages/app/release/deepseek-routing-20260906/Calmnova-Code-1.0.3-arm64.dmg`
- 构建时间：2026-09-06 21:03:02 +0800；230145422 bytes。
- SHA-256：`c56757e69394210146f793ff64f4a1f6bec6504dbd83847e3e3296a242bd6d64`。
- 从该 DMG 只读挂载复制到 `release/deepseek-routing-20260906/installed/Calmnova Code.app`；镜像校验和 codesign --verify --deep --strict 通过。旧包与 /Applications 旧安装版未覆盖；未关闭任何系统安全保护。
- 旧版退出时自动化窗口不可读，确认无运行任务后结束其残留进程，释放 15722；新副本后台打开后需正常激活窗口才能由桌面工具读取。
- 新副本同一独立验收会话、项目 `/private/tmp/calmnova-interrupt-r2`，已有模型配置，低推理预算；本轮安装副本只发送以下三次真实任务，不调用工具或读取文件：

| 时间     | 模型              | 真实结果          |
| -------- | ----------------- | ----------------- |
| 21:07:30 | GPT-5.5           | GPT 首次正常      |
| 21:08:36 | DeepSeek V4 Flash | DeepSeek 切换正常 |
| 21:09:56 | GPT-5.5           | GPT 切回正常      |

三次均完成。DeepSeek 未再进入 codex-auth/403；同会话 GPT 切回仍正常。截图均来自 Electron 安装副本，非浏览器预览。DeepSeek 文本在现有界面归为“中间过程 / 活动”，展开后可见；本轮按要求不扩展 UI 修改。模型切换时 runtime 仍会显示原生的跨模型恢复提示，没有隐藏。

Kimi 未配置，不做真实调用；其路由隔离由回归和真实 bundled app-server 的 loopback 测试验证。DeepSeek pro/r1 未增加外部调用。单测与协议验证不代替这些外部服务的实测。本轮未声称旧 403 失败回合获得回复，也未重发其用户任务。

未 commit、push、合并或发布。最终分支仍为 feat/codex-style-ui；工作区保留此前全部未提交成果，新增本轮主进程修复、两个测试文件和本记录/截图。
