# Calmnova Code 1.0.5 — R2 In-App Update V1

日期：2026-09-07。分支：`feat/in-app-update-v1`。基线：当前最新 `origin/main` 的 `5428671`（Merge pull request #4）；最终收口前确认 HEAD 与 origin/main 一致，已包含 DeepSeek continuation commit `5275dc7` 与 PR #3 Tool Loop Guard。本轮仅整合验证、更新报告和提交 In-App Update V1；不创建 tag、Release，不 push。原有无关 untracked 文件保留。

**结论：检查、手动下载、SHA-512 校验、重试、更新说明及 UI 链路已实现并验证。当前 ad-hoc 签名无法通过 Squirrel 的原生安装验证，因此提供“打开下载的安装包”安全 fallback，不能宣称已完成一键重启安装。**

完整自动化测试通过 **85 个文件 / 646 项**。隔离 packaged updater E2E 和合成 Agent/workspace/UI 回归通过。另有两项明确未完成：GitHub 云端 Draft 上传验证；原样完整安装版在空白 HOME 下的完整启动（macOS 钥匙串授权阻塞）。

## 1. 原有 updater 能力

复用 `UpdateService.ts` 和 electron-updater 6.8.3，未建立第二套生产 updater。原有功能包括 checkForUpdates、downloadUpdate、download-progress、update-downloaded、quitAndInstall、3 秒启动检查、IPC 状态广播、设置页、顶部通知，以及 `canInstall → CodexServerManager.hasActiveTurns()`。

原有问题：`publish: null` 导致本地 1.0.4 为 unconfigured；顶部通知直接执行下载/安装；错误可能残留 progress；并发保护依赖状态字段；无发布日期及签名能力分流；release workflow 仅手动打包、无完整验证及 Release 上传。

## 2. 新增架构与修改范围

- 在原 UpdateService 内固定 GitHub stable provider，禁用自动下载、退出时自动安装、降级和预发布。
- 用独立 operation 锁串行化 check/download，错误事件早于 Promise reject 时也不会重复请求。
- 增加发布日期、installMode、installing 状态；集中清理失败进度。
- 检查当前 macOS bundle 的 Developer ID Application authority，ad-hoc/无法识别时采用 manual 模式；保留原生校验。
- 自动模式先让 Squirrel 准备更新，在 native update-downloaded 时再次检查任务状态，再调用 electron-updater.quitAndInstall。超时/失败不强制退出。
- `updateActivity.ts` 统计异步文本写入和 workspace patch，加入安装许可判断；不改变写入内容、Provider 路由、Agent 行为或持久化格式。
- 顶部只进入设置；设置页显示当前/最新版本、发布日期、说明、真实字节进度、明确动作及签名限制。失败可重新检查 metadata 或重试下载。

主要修改文件：

| 范围 | 文件 |
| --- | --- |
| 更新服务与测试 | `packages/app/src/main/services/UpdateService.ts`、`UpdateService.test.ts`、`updateActivity.ts`、`updateActivity.test.ts` |
| 更新安全接线 | `packages/app/src/main/main.ts`、`ipc/handlers/app.handlers.ts`、`ipc/handlers/workspace.handlers.ts` |
| UI/契约 | `SettingsUpdateTab.vue`、`TopBarUpdateNotice.vue`、`i18n/messages/zh-CN.ts`、`en-US.ts`、`packages/shared/src/ipc/contracts.ts` |
| 打包/发布 | `packages/app/package.json`、`electron-builder.yml`、`.github/workflows/release.yml`、`pnpm-lock.yaml`、`productPackaging.test.ts` |
| 发布检查 | `scripts/verify-update-release.mjs`、`verify-update-release.test.mjs` |
| 隔离验收 | `scripts/update-fixture.mjs`、`update-fixture-entry.ts`、`update-gui-regression.mjs`、`update-packaged-smoke.mjs` |

路径简写中的 scripts 均位于 `packages/app/scripts`，Vue 文件位于原有 renderer/layout 目录。完整 Git 清单见 [changed-tracked-files.txt](validation/changed-tracked-files.txt) 与 [git-status.txt](validation/git-status.txt)。

## 3. GitHub release flow

仅目标仓库 `yazhou421-source/codeNexus` 的 `push` tag `v*` 触发；fork/PR 不发布。`contents: write`、release environment、同 tag concurrency 串行保护。

顺序：验证 stable tag 与 package version 精确一致 → 拒绝已有 Release（含 Draft）→ frozen-lockfile 安装 → `pnpm ci` 完整验证 → runtime fetch/verify → electron-builder `--publish never` → 校验产物 → 保存 Actions artifact → API 创建 Draft → `gh release upload`（无 `--clobber`）。

任何前置失败均不会创建 Draft。若上传阶段中断，可能留下不完整 Draft；重跑会拒绝覆盖，维护者必须先检查该 Draft，再决定如何处理。不会自动 Publish，必须人工审阅发布。

`macos-14` 是当前 GitHub 标准 arm64 runner，参见 [GitHub runner 文档](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

## 4. Production feed 配置

生产代码固定 `{ provider: github, owner: yazhou421-source, repo: codeNexus, private: false, releaseType: release }`，无环境变量、IPC、Provider 设置或用户 URL 入口。开发模式不访问生产源。存在 packaged `app-update.yml` 时启用固定生产 provider；旧无 feed 构建保持 unconfigured。

builder 的 `releaseType: draft` 仅用于发布默认值；生产运行时显式使用固定 public GitHub stable provider，不能读取未发布 Draft，也不消费 GH_TOKEN/GITHUB_TOKEN。没有远程动态换仓库逻辑。

本地 `pnpm --filter @codenexus/app dist` 始终包含 `--publish never`。前轮只读 GitHub 核查时，仓库为 public、默认分支 main、Release 列表为空；本次未执行云端发布操作。

## 5. Version strategy 与迁移

App package version 改为 **1.0.5**，1.0.4 不具备生产 feed，无法凭空发现此版本，仍需一次 bootstrap 手工安装。无需重新设置 Provider、Codex 登录、workspace 或历史数据；更新代码不写这些配置。

fixture app 使用独立 `com.calmnova.updatefixture`、`0.0.1 → 0.0.2`，不创建虚假正式 v1.0.6。UI 截图中的 1.0.6 为明确的合成状态快照，不对应网络 Release 或正式 artifact。

在签名限制解除前，后续新版可在 App 内发现并下载，但仍需手动完成 ZIP 安装；不能承诺 ad-hoc 的 1.0.5 从此完全免手工安装。

## 6. Update state machine

| 状态 | 行为 |
| --- | --- |
| unconfigured / unsupported | 不连接 feed，动作禁用 |
| idle | 等待检查 |
| checking | 单个检查请求，清理旧进度与错误 |
| not_available | 无新版；顶部安静 |
| available | 显示版本与说明，由用户选择下载 |
| downloading | 单个下载请求；百分比、已传输/总 MB 来自 updater |
| downloaded | manual 显示“打开下载的安装包”；automatic 显示“重启并安装” |
| installing | 等待原生 staging；再次检查任务状态，不重复安装 |
| error | progress=null；可重新检查或重试下载 |

下载完成后再检查不会丢弃安装动作。网络/404/限流/metadata/缺失 ZIP/中断/checksum 错误均为可恢复失败，原始 URL/token 不进入 UI 错误文本。

## 7. Integrity / security 与任务保护

下载与 SHA-512 校验全部使用 electron-updater 的原生实现与 electron-builder metadata。未自行实现 ZIP 下载/覆盖 App、跳过 checksum、关闭签名验证、修改 Gatekeeper、sudo 替换应用或运行远端脚本。

manual fallback 只接受 update-downloaded 返回且存在的文件路径，通过 Electron `shell.openPath` 交给 macOS 打开已校验 ZIP；不自动解压或替换 Applications。缺失缓存文件会回到可重新下载状态。

安装前保留 `hasActiveTurns()`：覆盖已运行 turn、正在发送的 turn/start 与等待生命周期事件的 turn；approval/tool 执行期间 turn 尚未结束，因此保持阻止。另统计编辑器文本写入与 workspace patch。安装 staging 结束时重检 busy；若有新任务，保留 downloaded 并等待用户下一次操作，绝不强杀 Agent。

更新服务无 `~/.codex/config.toml` 或 `auth.json` 访问。fixture updater 入口只导入 updater，不导入 Codex/Provider；HOME/userData/cache 使用隔离目录。原生 ShipIt 使用系统决定的 `~/Library/Caches/com.calmnova.updatefixture.ShipIt`，这是独立测试身份的缓存，不是用户生产配置。

## 8. macOS signing 实际结果

本机：macOS 26.6.2、arm64，Electron 40.10.0、electron-builder 26.8.1、electron-updater 6.8.3。最终 bundle：`Signature=adhoc`、`TeamIdentifier=not set`、flags 含 adhoc/runtime；未 notarize。见 [signing.txt](validation/signing.txt)。

实测分阶段结果：

| 阶段 | 结果 |
| --- | --- |
| packaged check | 成功发现 0.0.2 |
| ZIP download / SHA-512 | 成功；有真实 transferred/total 进度 |
| 错误 SHA-512 | 被拒绝，progress 清空；正确 metadata 后重试成功 |
| 手动 fallback | `shell.openPath` 实际返回成功，未退出 fixture |
| Squirrel staging | 原生签名验证拒绝 |
| 真实 restart/install | **未成功，未替换 app** |

原生错误（省略本地缓存路径）：`Code signature ... did not pass validation: 代码未能满足指定的代码要求`。这不是通过 mock 推测的结果，而是两个 ad-hoc packaged app 的实际原生尝试。见 [fixture-result.json](validation/fixture-result.json)。

源码核查：MacUpdater 下载 ZIP 并校验后先发 electron-updater `update-downloaded`；在关闭 autoInstallOnAppQuit 时，Squirrel 原生校验直到安装准备才执行。因此下载完成不能表示签名已通过。官方也明确要求 macOS 自动更新的应用签名：[Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)、[electron-builder auto update](https://www.electron.build/v26/docs/features/auto-update/)。

## 9. Fixture E2E 与安装版验收

重现命令（macOS，需要允许本地监听和 GUI）：

```sh
node packages/app/scripts/update-fixture.mjs --run
node packages/app/scripts/update-gui-regression.mjs --run
node packages/app/scripts/update-packaged-smoke.mjs --run
```

前两个完成。updater fixture：真实打包低/高版本 → loopback feed → 404 → 错误 checksum → 重试正确 metadata → 下载 → busy 阻止安装 → manual 打开 ZIP → 独立 native probe 签名拒绝。日志：[fixture.log](validation/fixture.log)。

合成 GUI 测试复用已有 Agent/workspace 驱动，编译到临时目录。仅测试产物替换凭据存储为内存合成值，并用临时 Router 端口；生产源及生产加密逻辑未改变。更新 UI 的 metadata 为合成快照，真实下载完整性另由 packaged updater fixture 验证。

原样完整 1.0.5 app 已用 ditto 安装到临时目录，codesign --verify --deep --strict 通过。启动时在空白 HOME 下阻塞于 macOS 钥匙串 SecItemAdd / AuthorizationCopyRights，未完成 renderer/3 秒检查验收。未绕过钥匙串授权、未修改系统安全配置；已停止本轮无 Agent 的临时进程。详见 [packaged-startup-sample.txt](validation/packaged-startup-sample.txt)、[packaged-smoke.log](validation/packaged-smoke.log)。用户原有 `/Applications/Calmnova Code.app` 未替换、未停止。

因此：**不能将合成 GUI 测试等同于原样完整安装版全部验收通过。**

## 10. GitHub Draft Release asset 检查

本地已按 workflow 的相同 builder/validator 命令生成并验证：

- `Calmnova-Code-1.0.5-arm64.dmg`
- `Calmnova-Code-1.0.5-arm64.zip`
- 对应 `.dmg.blockmap`、`.zip.blockmap`
- `latest-mac.yml`

[latest-mac.yml](latest-mac.yml) 与 [assets.json](validation/assets.json)：version=1.0.5、两个相对文件名精确匹配、size 与磁盘一致、SHA-512 重算一致、blockmap 非空。metadata 使用明确键白名单，无本地路径、用户名、token 或 secret。

**云端 Draft 创建/上传未执行。** 本轮只授权一次本地 updater commit，禁止 push、创建 tag/Release 或 Publish；不能把本地验证称为 GitHub Actions 已成功运行。没有真实发布 1.0.5 或 1.0.6。正式使用前仍需维护者推送经过审查的代码/tag，确认 Draft assets 后人工 Publish。

## 11. 自动化测试

全量：**85 test files / 646 tests passed**，见 [test.log](validation/test.log)。其中 UpdateService 29 项、写入保护 1 项、release validator/workflow 5 项；原有 packaging 测试同步验证新版本及仓库。

A–O 覆盖：configured/无 feed、无更新/有更新、进度/完成、checksum、网络及 retry、busy/idle 安装、降级/prerelease 拒绝、release notes/date（含 YAML Date）、延迟检查、check/download 并发、更新错误不走 Provider/Codex 配置代码。Squirrel staging 后的二次任务检查、缓存安装包缺失、脱敏错误亦覆盖。

最初受限执行环境无法 listen 127.0.0.1，导致网络集成测试 EPERM；在获准运行本地监听后全量重跑通过。最终结果不包含那些环境失败。

## 12. Full regression 与最终命令

| 检查 | 结果 |
| --- | --- |
| pnpm test | 85 / 646 全通过 |
| pnpm lint | 通过 |
| pnpm typecheck | 6 个 workspace 包通过 |
| pnpm build | 通过；最终 dist 也重新执行了 build |
| pnpm format:check | 通过 |
| pnpm codex:types:verify | 通过 |
| git diff --check | 通过 |
| pnpm --filter @codenexus/app dist | 通过，--publish never |
| packaged updater fixture | check/download/checksum/retry/fallback 通过；原生安装按实际结果失败 |
| Agent/workspace 合成 GUI | 通过 |
| 更新 UI 合成 GUI | 顶部到设置、50% 与 MB 进度、downloaded 按钮、error 无残留进度通过 |
| 原样完整安装版 startup/shutdown | 因钥匙串授权未完成 |
| GitHub Actions / Draft 上传 | 未执行 |

全量包含官方 Codex/Calmnova 配置隔离、modelCatalog/Astra、runtime.draft、tool-loop-guard、CodexServerManager、workspace authorization/git diff 等回归。GUI 另实际执行合成 Agent send、流式回复、工具续接、创建/修改/重命名/删除文件、差异显示、编辑器草稿保留、快速模型/线程切换，无重复 thread。见 [workspace-agent-e2e.log](validation/workspace-agent-e2e.log)。

GUI 截图：[downloaded](validation/update-downloaded.png)、[error](validation/update-error.png)。这些为合成快照，不能用于证明正式 v1.0.6 存在。

## 13. 当前限制与交付物

1. ad-hoc 无法完成已测试的一键重启安装；当前入口是打开 updater 校验的 ZIP，仍需用户手动安装。
2. Developer ID/notarization 的真实成功安装尚未验证；证书接入后必须补做跨版本原生 E2E。
3. 前轮核查时 GitHub 没有已发布 Release；在人工发布之前，生产检查可能返回缺失 metadata/Release 的错误。
4. 云端 Draft 上传和原样完整安装版钥匙串授权后的启动仍待验收，不标为完成。
5. 本轮未测试真实云端账户/付费 Provider 调用；回归使用合成上游，未读取 auth.json。

安装包位于 `packages/app/release/`。更新报告和证据位于本目录。本轮提交采用明确文件列表，只纳入 updater 生产代码、测试、fixture、release validator 和本报告/安全 metadata；排除 validation 下截图、临时驱动、私人路径/日志及所有无关 untracked。原报告中 validation 链接对应本地留存证据，不纳入 Git 提交。

## 14. 未来 Developer ID / notarization

通过 GitHub `release` environment secrets 提供 `CSC_LINK`（Developer ID Application P12）、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。无证书/密码写入仓库或日志。

有 CSC_LINK 时 workflow 启用身份发现并要求 forceCodeSigning；mac.hardenedRuntime=true；electron-builder 根据 Apple secrets notarize/staple，随后执行 codesign 严格验证及 stapler validate。配置不完整或验证失败则不创建 Draft。

正式放行前需验证：同产品身份、合适证书链、两版 Developer ID 签名且 notarized/stapled、正常用户会话与钥匙串下的安装版启动、原生 quitAndInstall 后版本变化、用户数据保留、运行中任务阻止安装，再人工 Publish Draft。参见 [electron-builder notarization](https://www.electron.build/v26/docs/features/code-signing/notarization/)。本轮没有索取或使用 Apple 证书。


## 15. 5428671 最终组合收口

本次基线为 `5428671`：`5428671 → 5275dc7 → ebe7e03`，分别对应 PR #4 merge、DeepSeek reasoning continuation 修复、PR #3 merge。DeepSeek / Tool Loop Guard 已属于 main；当前 updater diff 不包含它们的生产源码。`main.ts` 只提交 `hasPendingUpdateWork` import、安装前并行写入保护、退出时 dispose 三个 updater hunk。

实际组合测试为 **85 文件 / 646 项，全通过**，未调用真实收费 Provider、未上传真实项目。重点覆盖：

| 要求 | 本次验证 |
| --- | --- |
| DeepSeek Pro/Flash 相关转换 | `deepseek-continuation`、`deepseek-evaluation`、`deepseek-native-evaluation`、provider registry 与 streaming mock 测试通过；不重做收费在线调用 |
| Tool Loop Guard | exact repeat / hard ceiling 16 等完整 guard 测试通过 |
| Codex config isolation | `codexConfigProtection`、`codexConfigRepair`、配置导入隔离测试通过 |
| Astra / model catalog | shared modelCatalog、CodexModelCatalogService、renderer catalog 测试通过 |
| Draft isolation | runtime.draft 与 GUI 草稿保留通过 |
| Agent send / workspace | CodexServerManager、workspace IPC/授权/diff 测试与合成 GUI send/stream/tool continuation 通过 |
| Updater state machine | UpdateService、updateActivity 全部通过 |
| Integrity / metadata | release validator 通过名称、size、SHA-512、metadata 键白名单；mismatched/prerelease tag 拒绝测试通过 |
| Package metadata | version=1.0.5、bundleId=com.calmnova.code、固定 production feed、codesign 严格结构校验通过 |

`pnpm test`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm format:check`、`pnpm codex:types:verify`、`git diff --check` 均通过。Codex 类型校验为 runtime 0.153.2、827 个 TypeScript 文件与 416 个 JSON schema 文件。

`pnpm --filter @codenexus/app dist` 返回 0，包含 `--publish never`，生成并验证：

| 产物 | Bytes |
| --- | ---: |
| Calmnova-Code-1.0.5-arm64.dmg | 230175066 |
| Calmnova-Code-1.0.5-arm64.zip | 221480237 |
| Calmnova-Code-1.0.5-arm64.dmg.blockmap | 239478 |
| Calmnova-Code-1.0.5-arm64.zip.blockmap | 229439 |
| latest-mac.yml | 515 |

本目录 `latest-mac.yml` 是这次最终组合构建的安全 metadata 快照，不代表已发布。签名仍为 ad-hoc，未 notarize。

发布安全复查：production repo 固定 `yazhou421-source/codeNexus`；stable only；`allowDowngrade=false`、`allowPrerelease=false`；tag 必须精确等于 package version；workflow 使用 `contents: write`、Draft-only、拒绝已有 Release、无 `--clobber`；secrets 仅从 Actions environment 传入，不打印。生产 updater 的 public provider（private=false、无 token）读取公开 latest stable release，未发布 Draft 不会被消费。

本次允许的 Git 变更仅为 updater 文件与本报告、安全 metadata。所有 validation 截图、临时 QA 驱动、个人路径/日志与其他无关 untracked 保留在本地，不暂存。验证过程没有修改生产源码或 fixture 脚本。

本次再次运行 packaged updater fixture，check/download/SHA-512 拒绝/retry/manual fallback 全部通过；Squirrel native probe 再次返回签名验证失败。**真正 quitAndInstall 仍未成功，GitHub 云端 Draft 上传仍未执行，Developer ID + notarization 仍是未来要求。** GUI 合成 Agent/workspace/updater 状态回归也再次通过；原样完整安装版的钥匙串启动限制保留，未绕过系统安全要求。
