# CalmNova 桌面试用 · 当前候选版

2026-09-07 启动加载回归修复：当前候选包更新为 `packages/app/release/model-startup-1.0.4-20260907/Calmnova-Code-1.0.4-arm64.dmg`。新安装副本在无工作区启动页自动加载 7 项 Codex 模型；Astra 一次真实回复及退出重启后的列表恢复通过。详见 [实际根因、517 项测试、RPC 核查与安装版验收结果](../model-review/STARTUP-REGRESSION.md)。以下记录保留，其“最新”按各记录当时含义理解。

2026-09-07 最新补充：当前同版本候选包为 `packages/app/release/model-catalog-1.0.4-20260907-r2/Calmnova-Code-1.0.4-arm64.dmg`。已修复 Codex 模型列表被本地静态目录限制的问题，安装副本菜单已显示账户返回的 `gpt-6-astra`；本轮未发送 Astra 任务。详见 [模型目录证据、508 项测试与安装版验收结果、校验和](../model-review/CODEX-MODELS.md)。以下旧包及验收记录保留。

2026-09-07 前次补充：`packages/app/release/answer-display-1.0.4-20260906/Calmnova-Code-1.0.4-arm64.dmg` 修正缺省 phase 的 DeepSeek 最终正文被折叠的问题。见 [消息分类根因、测试与安装版验收结果](../message-review/DEEPSEEK-FINAL.md)。

当前为 **macOS arm64 · 1.0.4 本机试用候选版（认证状态与更新基础能力）**，未公开发布。详见 [1.0.4 实机验收结果、安装包校验和与发布配置说明](../release-1.0.4/README.md)。更新源按用户要求未配置，真实在线下载/重启安装未验证；不能标为完整自动更新验收通过。

认证/更新初版 DMG（已由上方候选包接替）：`packages/app/release/trial-1.0.4-20260906/Calmnova-Code-1.0.4-arm64.dmg`。构建时间 2026-09-06 21:34:30 +0800，SHA-256：`e4525d921cece2a253c28b2013d3fb04b84d017e8dbd001deadc6f39d37943a0`。

以下保留 **1.0.3** 路由修复记录，其结论不自动视为 1.0.4 的重新验收：

- 1.0.3 DMG：`packages/app/release/deepseek-routing-20260906/Calmnova-Code-1.0.3-arm64.dmg`
- 构建时间：2026-09-06 21:03:02 +0800；230145422 bytes。
- SHA-256：`c56757e69394210146f793ff64f4a1f6bec6504dbd83847e3e3296a242bd6d64`。
- [本轮路由根因、回归与安装副本验收结果](../routing-review/DEEPSEEK.md)：同会话 GPT-5.5 → DeepSeek V4 Flash → GPT-5.5 三次真实调用完成；462 项测试通过。DeepSeek 回复目前需展开“中间过程”查看，本轮未改 UI。
- 前轮 UI、精简和历史验收见 [OPTIMIZATION.md](OPTIMIZATION.md)；其旧 DMG 保留，未覆盖。
- IME、精确 1280×800/1440×900 窗口和内容区尺寸、部分原生窗口操作仍未完整验证；前轮重载 active writer 限制仍在。不能标为全面验收通过。
- 版本、产品身份、用户数据目录不变；未 commit、push 或公开发布。

旧记录：[R2 中断恢复验收](DESKTOP-TRIAL-R2.md)、[R1 桌面试用](DESKTOP-TRIAL-R1.md)。旧 DMG 保留。
