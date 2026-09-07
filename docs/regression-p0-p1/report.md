# Calmnova Code P0 / P1 修复报告

2026-09-07。三个问题的代码修复和回归已完成；**P0 九步桌面最终验收通过**。官方桌面三次成功回复由用户手动操作并明确确认，Calmnova 桌面发送、退出、SHA 与端口检查由工具验证。没有 push；没有改 Logo、Design System 样式或做新的 UI 重构。原有未跟踪截图与历史文档均保留。

## 1. P0 真正写入源与修复

确定的代码链是：

`CodexProfilesSettingsTab.readCodexConfig` 读取 `config/read.config`（其中已合并 Router 的进程级 `-c` 配置）→ `autoImportCurrentCodexConfig` 将这些运行时值存为用户配置档，并绑定官方 `~/.codex/config.toml` → 用户应用配置档时，`codexProfileRuntime.applyCodexProfile` 通过 `app.writeTextFile` 或 `requestConfigBatchWrite` → `config/batchWrite` 持久写入官方文件。

前者可以完整写入配置档文本，后者写入 `model_provider`、`model`、`model_providers.<id>`。这解释了实机文件中的 `codenexus-router-codex` 与 localhost `/codex-auth/v1`。仅打开页面会自动生成配置档；实际写官方文件发生在应用配置档时。未读取历史操作正文，无法证明用户当时的具体点击时刻；已定位能生成完全相同污染内容的实际代码路径。

处理：

- 自动导入只读取未禁用的持久化 `user` 配置层，绝不从有效配置或 `sessionFlags` 回退导入。
- 自动导入与应用旧配置档都拒绝 Calmnova Router 标识/端点；应用检查在认证写入之前完成。
- 在 `CodexAppServer.request` 保护两个配置写 RPC；通知不能绕过保护。默认共享路径、显式官方路径、环境 `CODEX_HOME` 路径、符号链接和硬链接别名均拒绝。
- 通用文本写入、删除及旧配置备份恢复同样保护共享 `config.toml` / `auth.json`。
- 聊天 Router 继续使用原有 `codexRouterRuntime.globalConfigOverrides`，只影响子进程。
- 旧“全局配置”功能现在会明确拒绝写共享文件；正常 AI Provider 页继续使用应用私有设置和 Router。没有把被拒绝的写入伪装成保存成功，也没有新增一套全局配置切换机制。

已审查其它入口：Provider 设置/切换写应用私有 Provider preferences、secret store 与 model-catalog；onboarding 检测和产品迁移处理应用 userData；Router 初始化只生成 `-c`；config import 的配置集服务保存应用私有 JSON；MCP/global config 的写入经过同一受保护 RPC。另一个真实写入入口 `CodexConfigSwitcherService.restoreBackup` 已保护，不能重新覆盖官方文件。旧恢复备份目录不是当前运行代码。

## 2. 一次性 migration / repair

启动服务前检查共享配置。仅对可确认的 Calmnova Router 段及其根级选择/端点进行按行删除，保留其余原始字节和换行，不重新序列化 TOML。

先独占创建原始配置备份，再核对 inode 与文件内容；没有变更就不创建备份。修复幂等。普通用户 localhost Provider 保留；未知自定义字段、复杂/多行 TOML、无法确认归属的内容、符号链接或多硬链接文件不自动修复。不会读取或修改认证文件。

备份名：`config.toml.calmnova-repair-<uuid>.bak`。本机当前配置已由用户手工清洁，本次没有需要修复的实际污染，因此没有生成本机迁移备份；备份与字节保留行为已用临时配置实测。

## 3. 草稿问题根因

空线程通过 `threadKey("")` 与 `__app__` 共用持久化状态，启动 hydrate/load 会恢复其 `composeInput`。另外，从已有线程新建时，`buildNewThreadComposeSeed` 原来改取 global defaults，导致偏好可能被复位。

修复后：真实 threadId 草稿继续恢复；`__app__` 仅持久化偏好，首页加载或进入新线程清空输入、附件、文件引用和 history rewrite；新线程继承 model/reasoning/sandbox/composeMode；发送接受路径等待空草稿落盘。保留服务端支持的 max/ultra 等 reasoning 值。

旧安装版普通界面已复现用户提供的 QA 文字恢复。修复版完整 UI 重启验收受锁屏阻断；自动化已覆盖真实草稿恢复、新首页清空、切回旧草稿、偏好保留、发送后重启不恢复。

## 4. Astra 的真实根因与原始目录

同一安装版 Codex、同一 ChatGPT 登录的只读对照：

| 查询环境 | 结果 |
| --- | --- |
| 正常官方配置，includeHidden=true | 9 项；Astra 存在，hidden=false，isDefault=true |
| 仅在子进程施加旧 Router 配置 | 成功、完整目录 5 项；Astra 消失 |
| 只恢复 model_provider=openai，保留 Router openai_base_url | 仍为 5 项，Astra 消失 |
| 子进程同时恢复官方 Provider 和官方 Codex 端点 | 7 项可见目录，Astra 恢复 |

因此 Router 污染会改变目录请求的端点/来源。Astra 本次不是账户被撤权，也不是 hidden 过滤造成。旧代码还把不存在的当前模型强行保留在 picker，并且 Provider revision 会清空独立账户目录，放大状态不一致。

修复后的 `CodexModelCatalogService` 使用独立的 `globalConfigOverrides`：官方 Provider `openai` 与 `https://chatgpt.com/backend-api/codex`，不读取 Router 目录，不改用户配置。继续依赖真实 `model/list`、消费完整分页、保留默认模型和推理元数据；没有硬编码启用 Astra。

普通启动旧安装版时，当前模型为 gpt-5.5；菜单已显示 Astra 可选。故不能声称该次普通启动仍复现了原始“不可用”界面。目录差异已通过安全进程覆盖实机复现。

`remoteLoadState` / `remoteLoadedAt` 的旧安装版内存值未取得：自动审批拒绝了远程调试端口和本地 DevTools 状态脚本，不能用推测填补。

依据：[官方 model/list 文档](https://learn.chatgpt.com/docs/app-server#models) 中 hidden 是默认 picker 可见性，isDefault 是推荐默认。保持 hidden 策略，没有擅自把隐藏模型开放。

## 5. Fallback 与文案规则

仅当当前账号已登录，且完整账户目录成功、状态 ready，才校正当前 Codex 模型。优先服务端可见 isDefault → 目录中存在的 gpt-5.6-sol → 首项可见 remoteIds。没有可见候选时不凭空造模型。推理等级按新模型 supportedReasoningEfforts 校正，优先其有效默认等级。

临时失败、超时、分页未完成、加载中或登录变化不会据此撤销旧选择；保留最近成功目录。Provider revision 不再清空账户目录。旧 generation 的结果不能覆盖新登录后的目录。API Provider 模型使用其连接状态，账户 fallback 不改它。

文案分别为：

- 账户目录不含当前模型：当前账户暂不可用。
- Provider 失败：服务连接不可用 · 请检查服务设置。
- 登出：请先登录 ChatGPT/Codex。
- 加载：正在读取可用模型…。
- 刷新失败：模型列表暂时无法刷新。
- 成功目录触发 fallback：`{model} 当前未对该账户开放，已切换到可用模型。`

按钮和发送入口都检查已知的不可用状态。推理子菜单使用服务端元数据；未改样式。

## 6. 修改文件

主要修改：`codexAppServer`、`CodexModelCatalogService`、`main`、配置/文件写入与恢复服务；模型配置页和 profile runtime；`runtime.store`、`localDraftState`、`newThreadComposeSeed`、发送草稿路径；modelCatalog/providerRegistry stores；Composer/CenterPane/ChatPane 的模型元数据与文案。

新增：配置 ownership/protection/repair、只读取持久 user 层的 import helper，以及对应回归测试。完整列表见同目录 `git-diff-stat.txt`、`new-source-files.txt` 和 `git-status.txt`。`git diff --stat` 不包含新增未跟踪文件，需与新文件清单一起看。

## 7. 自动化测试

最终全量 vitest：76 个测试文件、569 项测试全部通过；pnpm lint、pnpm typecheck、pnpm build、git diff --check 均通过，见同目录日志。P0-1～4 在真实 bundled app-server 双进程测试中共用临时合成登录和用户配置，分别走两个独立端点；正常退出/关闭 Router 连接与监听后，独立 Codex 仍完成请求，配置字节不变。这里的官方端点是测试服务器，不是实际 OpenAI 服务；真实服务测试另见下一节。

P0-5 覆盖原始备份、CRLF、用户 localhost Provider、未知字段/子表/多行文本、幂等、认证文件不变。P0-6 覆盖持久 user 层导入、Router 配置档在认证写入前被拒绝、配置 RPC/路径别名保护，现有 Provider/onboarding 测试也运行通过。

草稿 A～F、模型 G～M 均有覆盖，包括推荐/default fallback、Sol 不存在时首项、临时失败、登出、Provider 与账户的不同原因、hidden、陈旧 generation 与 Provider revision。

## 8. 实机测试与 SHA

用官方 `/Applications/ChatGPT.app/Contents/Resources/codex` 保持一个新的 ephemeral、read-only 会话；另用仓库生产 EmbeddedRouterManager / createCodexRouterRuntime 和 Calmnova 安装版 Codex 构建运行时链路。两者共用现有 ChatGPT 登录，没有通过诊断脚本读取、复制或修改 auth.json，没有输出 email、token、Authorization 值或历史正文。

| 阶段 | 真实结果 |
| --- | --- |
| 官方 Codex，Calmnova Router 启动前 | gpt-6-astra / low，completed，OK，Provider=openai |
| Calmnova 生产 Router 链路 | gpt-6-astra / low，真实 POST /codex-auth/v1/responses，上游 200，completed，OK |
| 保持 Router 运行，再发送官方 Codex | completed，OK |
| 正常停止测试 Router / 其 Codex，再发送官方 Codex | completed，OK |

各阶段配置 SHA 相同：

```
Before 23fda44600a27cacddfc610e501c87d9971baad36f4e52a52bc2f5e0e7e94eeb
After  23fda44600a27cacddfc610e501c87d9971baad36f4e52a52bc2f5e0e7e94eeb
```

按用户指定正则检查官方配置，没有匹配项。详情见 `live-runtime-results.json`（从工具观测输出整理）和目录对照日志。对照用的子进程含未使用 Router 定义时，`containsRouterDefinitions=true` 不代表选中的 Provider 或端点走 Router；日志明确列出实际选择。

## 9. Astra 真实调用

**成功。** 官方运行时和 Calmnova 生产 Router 链路均实际使用 gpt-6-astra / low 返回 OK。随后最终打包应用桌面也两次使用 Astra / low 成功返回 OK，见下一节。

## 10. 安装产物与最终验收

最终产物：`packages/app/release/regression-p0-p1-final/mac-arm64/Calmnova Code.app`。已核对打包后的 main/preload/renderer index 与最终 build 一致；所有修改的 Vue style 块字节级未变。未覆盖 `/Applications/Calmnova Code.app`，当前系统安装版仍是旧版。打包为本地 ad-hoc 签名，没有发布或上传。

前轮曾遇到锁屏及调试授权限制；本轮用户已允许本地 DevTools 的白名单只读诊断，并手动完成钥匙串提示。通过原生 Calmnova UI 和已授权只读诊断取得：

- 账户 `logged_in`，目录 `ready`，`remoteLoadedAt=1788752179116`；7 个可用 ID，包含 Astra，与菜单一致。未输出账户对象或凭据。
- 桌面 Astra / low / 只读最小消息两次返回 OK，发送后 Composer 为空。
- 原线程留测试草稿 → 新对话输入框为空，模型/推理/权限保留；切回原线程恢复该线程草稿。测试草稿已清空。
- 正常退出并重启后首页为空，Astra / low / 只读偏好保留。
- 默认模型页显示 7 个可用模型并执行刷新；Provider DeepSeek Flash 开关关闭后恢复开启；历史 Router profile 启用被拒绝。
- 实机发现该早期拒绝原来只出现在控制台，已接入现有错误提示流程和页面错误文本；最终包实测可见。没有样式改动。
- 最终包 536 个构建文件均与 build 字节一致。补齐错误反馈后再次通过 76 文件/569 测试、lint、typecheck、build、diff check。测试需在沙箱外绑定临时 loopback 端口。

本轮启动、使用、Provider/配置页操作、正常退出，以及官方退出后消息成功后的最终配置 SHA 均为：

```
d4bafa80748ef27f5c9b3d6544a82008f966591ff76b8228f1bfcb74d58ddc5c
```

该 SHA 在本轮首次启动 Calmnova 前即已不同于前轮基线，不将两轮之间变化归因于本轮应用。最终九步的官方首次消息已由用户明确确认成功，官方窗口保持打开；最终 Calmnova 包随后通过 Astra 消息。用户已确认官方并行期间返回 OK；Calmnova 正常退出后，lsof 确认 15722 无监听，用户再次明确确认官方成功返回 OK。最后重新计算 SHA 与 Before 完全相同，指定 grep 命令无输出（exit 1 表示无匹配）。九步最终验收通过。官方桌面属于工具禁止操作的应用，未绕过该边界。详细时序见 `authorized-desktop-acceptance.json`。

Onboarding 和旧污染 migration 在隔离 fixture 中覆盖；现有用户已完成 onboarding，未重置其配置来伪造首次启动。尚未把这些 fixture 结果声称为实机污染迁移。

## 11. 版本收口范围

在 `fix/p0-p1-regressions` 上提交三个修复相关的 33 个源码与测试文件，以及以下 6 个验收文档；本次版本收口不再修改源码，不 push，不覆盖系统安装版。

- `report.md`：根因、修复边界与测试结论。
- `authorized-desktop-acceptance.json`：最终桌面九步验收记录。
- `live-runtime-results.json`：此前运行时级真实服务验证。
- `installed-catalog.json`：仅包含已登录状态和模型目录元数据，无账户身份或凭据。
- `config-sha256.txt`：此前运行时验证的 Before/After 摘要；最终桌面 SHA 见九步记录。
- `packaged-build-verification.json`：536 个打包文件与构建文件的比对结果。

上文引用的 `.log`、探测 `.mts`、`review.diff`、配置写入检索输出及 Git 状态/差异/新文件列表快照仅留本地，不随提交交付。旧 review 截图、历史临时目录及其它无关 untracked 文件保持原样，不暂存。未加入真实 auth.json、API key、token、credential、个人配置或临时日志；代码中的认证字段名和回归测试里的 synthetic 常量不是实际凭据。
