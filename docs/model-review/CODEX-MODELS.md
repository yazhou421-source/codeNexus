# Codex 账户模型目录 · 1.0.4

附件说明：验收截图、本机日志及统计快照仅保留在本地，不随源码提交；下文保留验收结论和场景说明。

后续修正：上次漏测未连接工作区的启动页。当前最新候选包与完整根因见 [启动加载回归修复](STARTUP-REGRESSION.md)；下方保留当时记录。

核查日期：2026-09-07（Asia/Shanghai）。分支 `feat/codex-style-ui`；保留此前未提交成果，未 commit、push 或发布。

## 当前账户返回

使用项目随包 Codex 0.153.2 app-server，继承现有登录，调用 `account/read` 和 `model/list`；没有读取或输出凭据内容，没有创建 thread/turn，没有发送模型任务。

`account/read` 返回 ChatGPT 账户；不带聊天运行时本地目录覆盖的 `model/list(includeHidden: false)` 返回以下 7 项，分页结束：

- `gpt-6-astra`：`hidden=false`、`isDefault=true`。
- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`
- `gpt-5.5`
- `gpt-5.4-mini`
- `gpt-5.3-codex-spark`

额外诊断查询的隐藏项没有进入菜单。以上证明当前登录目录向客户端提供了 Astra；本轮未验证 Astra 实际生成、额度或所有调用条件。

接口背景参考：[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)（查看于 2026-09-07）。账户结论来自本机实际查询，不来自文档或其他客户端菜单。

## 原因与修改

原 Composer 使用 shared/modelCatalog 中六个本地 GPT ID。已有远程查询仅供全局设置手动添加模型，并未驱动 Composer；同时，聊天 app-server 的 `model_catalog_json` 指向本地 Router 目录，覆盖了官方发现结果。用同一个二进制加载该目录，实际仅返回 `gpt-5.5`、`gpt-5.4`、`deepseek-v4-flash`、`qwen-plus`、`qwen-max`。Router 又要求先注册型号，因此只补菜单字符串不能解决问题。

本轮修改：

- 新增 `CodexModelCatalogService`：独立短生命周期 app-server 查询当前 ChatGPT 登录目录，不传入聊天运行时的本地目录覆盖；处理分页、隐藏项、并发与失败清理。
- `CodexServerManager` / `main.ts` 将模型发现接到该服务。
- `ProviderRuntimeService` 将返回的 Codex 型号同步到现有 Codex 认证路由和本地目录，继承已有 endpoint/auth 配置；保留 API Key Provider 路径和用户选择。不硬编码 Astra，不改凭据。
- `modelCatalog.store.ts`、shared `modelCatalog.ts`、`CenterPane.vue`、`GlobalConfigDrawer.vue` 使用账户返回的模型构建选项。连接后自动加载，窗口恢复焦点时按既有 60 秒缓存间隔刷新；旧服务结果不会覆盖新服务目录。
- 未返回或隐藏的 Codex 型号不作为可用选择。当前/历史已选的失去可用性型号保留为禁用项“当前不可用”，避免无提示改写用户选择。查询失败清除过期可用列表；API Key Provider 保持现有可用性判断。
- 将官方 `supportedReasoningEfforts` 正确映射到本地目录的 `supportedReasoningLevels`，未改 UI 布局。

## 验证

- 格式检查、lint、类型检查、构建通过；全量 **68 个测试文件、508 项测试通过**。
- 新增/扩展测试覆盖：Astra 存在与缺席、隐藏项、未登录、分页与并发、失败清除、切换服务的迟到结果、账户目录取代静态列表、API Key 路由保留、重复同步不重复更新。
- 使用真实 bundled Codex 加载临时测试目录，验证目录字段和推理级别能解析；该测试不使用用户凭据或发起模型任务。
- 从下述新 DMG 复制到独立 `installed/Calmnova Code.app`，签名校验通过并启动。连接空验收目录后，真实 Electron 模型菜单显示 Astra 和其余账户模型，DeepSeek V4 Flash 仍可选择，原 GPT-5.5 选择未变。
- 启动后的本地生成目录也包含这 7 个账户模型及原已启用 API Key 模型。
- **未验证：Astra 实际任务回复。** 没有将菜单可见或打包成功表述为完整模型调用验收。

本地截图记录：新 DMG 安装副本的实际模型菜单。

## 本轮安装包

- 平台 / 版本：macOS arm64 / **1.0.4**，本机试用候选版。
- DMG：`packages/app/release/model-catalog-1.0.4-20260907-r2/Calmnova-Code-1.0.4-arm64.dmg`
- 构建完成文件时间：**2026-09-07 00:28:41 +0800**。
- SHA-256：`60839e0a6a2623c5b9834d21a963feb39447928bb584559f5651cc96de3d1f89`
- 实际验收副本：同输出目录下 `installed/Calmnova Code.app`，来自新 DMG。
- 使用原有打包流程，ad-hoc 签名，未公证、未发布；未关闭系统安全保护。旧包保留；不应分发前一个未带 reasoning 字段修正的中间输出目录。
- 未升级依赖、未更改产品身份、版本号或用户数据目录。既有 UI/历史/认证/更新改动仍保留在当前未提交工作区。
