# CalmNova 1.0.4 本机试用候选版

附件说明：验收截图、本机日志及统计快照仅保留在本地，不随源码提交；下文保留验收结论和场景说明。

日期：2026-09-06。仅增加认证状态与应用更新基础能力；未公开发布，不代表全面桌面验收通过。

## 认证状态

本机安装副本通过 Codex 的 `config/read` 确认默认 `~/.codex`、`cli_auth_credentials_store=file`；`account/read` 返回 ChatGPT 账户，`account/rateLimits/read` 成功。本机 GPT-5.5 复用 **`~/.codex/auth.json` 中由 Codex 管理的 ChatGPT 登录凭据**，不是 DeepSeek API Key，也不是 CalmNova 另存的登录。

依据：`codexAppServer.ts` 继承进程环境；`codexRouterRuntime.ts` 为 Codex 模型保留 `/codex-auth/v1`，不覆盖 CODEX_HOME；API-key 模型仍走已有独立路由。本轮未读取、复制或输出 auth.json 内容，未改模型路由与凭据存储。

状态由主进程 `CodexAccountService` 检查，经安全 IPC DTO 到 `accountStatus.store`，显示于顶栏和设置 → AI 模型。Codex 的账户读取可能只返回本地缓存，因此额外使用账户额度接口验证认证，不发模型任务。遇到认证失败时只请求 Codex 刷新一次，再检查；不可恢复的认证失败显示“已失效”。超时、网络错误、普通 403/429 显示无法确认，不冒充未登录、失效或继续沿用旧的“已登录”。支持刷新与既有浏览器登录流程。

参考的是打包运行时对应的官方实现：

- [Codex rust-v0.153.2 账户处理器](https://github.com/openai/codex/blob/rust-v0.153.2/codex-rs/app-server/src/request_processors/account_processor.rs)：账户读取、刷新、额度请求。
- [Codex rust-v0.153.2 凭据存储](https://github.com/openai/codex/blob/rust-v0.153.2/codex-rs/login/src/auth/storage.rs)：file/keyring/auto 与 auth.json。

## 应用更新

沿用 electron-updater 和既有 IPC，补齐当前/最新版本、检查、下载进度、失败重试、下载后重启安装的状态管理。自动下载、退出时自动安装、降级、预发布更新均关闭；有活动模型任务时主进程拒绝重启安装。

按用户要求 **暂不配置线上源**：`electron-builder.yml` 为 `publish: null`，安装包中无 `app-update.yml`。启动、检查、下载不会访问上游或 origin 的更新服务；最新版本保持“未知”，状态为“更新源未配置”。移除了原来误指向上游 QinQinChina/codeNexus 的发布设置。Release workflow 仅允许手动构建并保存工作流产物，`--publish never`，无公开发布动作。

## 检查与实机证据

全部通过：`pnpm run format:check`、`pnpm run lint`、`pnpm run typecheck`、`pnpm run test`（65 文件、484 测试）、`pnpm run build`、`git diff --check`。

新增/扩展回归覆盖：未登录、已登录、不可恢复的失效、可刷新认证、网络不确定、并发检查合并、服务退出重建；未配置源时不调用 updater、检查/下载/进度/完成/安装生命周期、重复操作、下载失败重试、错误脱敏、任务运行时禁止重启安装。原路由和中断恢复测试保留。

实际从新 DMG 挂载后复制应用到本输出目录下 `installed/Calmnova Code.app`，启动此副本而非开发入口，未覆盖 /Applications 的旧版。

| 项目                                      | 结果                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| DMG 安装副本启动，Info.plist 版本和身份   | 通过：1.0.4 / com.calmnova.code                                        |
| `codesign --verify --deep --strict`       | 通过：本机 ad-hoc 签名；不是 Developer ID 签名/公证                    |
| 现有真实 Codex 登录验证、刷新             | 通过：顶栏及 AI 模型页显示已登录；刷新显示检查中再回到已登录并更新时间 |
| 更新设置和检查按钮                        | 通过：1.0.4 / 最新版本未知 / 更新源未配置，点击后更新时间              |
| 真正注销/撤销凭据、重新登录               | 未验证；未改动用户登录，状态分支由回归测试覆盖                         |
| 真实在线下载、跨版本重启安装              | 未验证：按要求无更新源，且无正式签名/公证；测试不能替代端到端验收      |
| 模型对话、IME、精确尺寸、所有原生窗口操作 | 本轮未重新验收；既有 1.0.3 记录保留，不扩大结论                        |

以下均为真实 Electron 安装副本截图，不是浏览器预览；截图没有密钥、令牌或账户邮箱。

本地截图记录：安装版认证状态。

本地截图记录：安装版更新源未配置。

## 安装包

- 平台：macOS arm64，版本：1.0.4。
- DMG：`packages/app/release/trial-1.0.4-20260906/Calmnova-Code-1.0.4-arm64.dmg`
- 构建产物时间：2026-09-06 21:34:30 +0800；230151886 bytes。
- DMG SHA-256：`e4525d921cece2a253c28b2013d3fb04b84d017e8dbd001deadc6f39d37943a0`。
- ZIP：同目录 `Calmnova-Code-1.0.4-arm64.zip`。
- ZIP SHA-256：`28d3b826e6db521a4911989b7fe55994f177d9962ff1a4e1d12d9042c0d720b2`。
- 本轮为 ad-hoc 签名本机候选包，未做 Apple 公证。未关闭系统安全保护。

## 后续正式发布配置

现有 electron-builder 26 / electron-updater 管道保留，未升级依赖。正式发布前独立确认更新源、签名和公证，再验证完整升级：

1. 将 `publish: null` 改为经过确认、由项目控制的 HTTPS generic 或 GitHub 更新源；不能推定 origin 就是获准的发布目标。由 builder 生成 `app-update.yml`，同时发布 `latest-mac.yml`、ZIP/DMG 及其 blockmap。不要在 Renderer 中配置令牌。
2. 使用 Developer ID Application 证书。沿用 builder 的 `CSC_LINK` / `CSC_KEY_PASSWORD` 或钥匙串 identity 配置，不提交证书和密码；保持应用 ID、产品身份及签名团队连续。
3. 接入 notarization：通过 CI secrets 提供 `APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`，或 Apple ID 方案的 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。结合当前 builder 版本核验 hardened runtime、所需 entitlements、公证及 stapling 结果；本轮未虚构这些配置已生效。
4. macOS 自动更新需要 ZIP 与有效代码签名，当前打包命令已同时产出 DMG 和 ZIP。用两个经过正式签名的版本，在真实安装副本上验证检查、下载进度、失败重试、重启安装与历史保留后才开启公开更新。参见 [electron-builder 自动更新](https://www.electron.build/docs/features/auto-update/) 和 [v26 macOS 配置](https://www.electron.build/v26/docs/mac/)。

分支：`feat/codex-style-ui`。工作区有既有和本轮未提交修改，旧安装包保留。修改前补充保存了 本地 1.0.4 优化前快照（未纳入仓库） 的 tracked patch、状态及重点文件副本（不是完整历史备份）。未执行 commit、push、合并或公开发布。未重置用户历史、产品 ID 或数据目录。
