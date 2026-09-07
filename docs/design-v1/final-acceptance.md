# Calmnova Code Design System V1 — 最终收尾验收

**结论：PASS WITH KNOWN LIMITATIONS。**

2026-09-07，macOS / Electron 开发客户端。分支 `feat/codex-style-ui`，HEAD `81995a8e7b6172b4725fea9094d41b2110033ff9`。未 commit、未 push、未暂存。没有再次重构页面或实现 Terminal。

本结论覆盖 V1 核心界面、已展示文件的 Diff 计数、指定键盘操作和本轮截图；不等同于完整 Git 审阅器、所有 Provider 真实连通性或 WCAG 全项认证。剩余范围限制见 B。

[打开 21 项截图图集](final-screenshots/index.html) · [原图清单、尺寸与校验值](final-screenshots/manifest.json) · [测试结果](final-validation/results.json)

## A. Diff 准确性结论

**定位并修复了真实数据源问题，未硬编码数字。** 当前 `app.handlers.ts` 的 Git 基准是 `+1 / -1`；修复后的 renderer 和实机 UI 同样显示 `+1 / -1`。

```text
git diff --numstat -- packages/app/src/main/ipc/handlers/app.handlers.ts
1    1    packages/app/src/main/ipc/handlers/app.handlers.ts

git diff --stat -- packages/app/src/main/ipc/handlers/app.handlers.ts
.../app.handlers.ts | 2 +-
1 file changed, 1 insertion(+), 1 deletion(-)
```

完整仓库基准分别保存在 [git-numstat.txt](final-validation/git-numstat.txt)、[git-stat.txt](final-validation/git-stat.txt)。本工作区暂存区为空，因此这里普通 `git diff` 与 `git diff HEAD` 的已跟踪文件范围一致。服务定义的基线是 **HEAD → 当前工作树，包含已暂存和未暂存改动**；不能拿“仅未暂存改动”去比较有暂存内容的工作区预览。

| 链路 | 定位结果与修复 |
|---|---|
| Git source：`main/services/workspaceGitDiff.ts` | 原 `wholeFileDiff` 把整个 HEAD 文件标为删除、整个当前文件标为新增。单行修改因此显示整文件替换。已改成调用真实 Git unified diff；保留只读、文件边界、符号链接、文本类型与容量检查。仅未跟踪／无 HEAD 的新增文件使用空基线表示。 |
| `WorkspacePatchService.readGitDiff` → IPC `workspaceGitDiffRead` | 传递 `diffText/status/skipped`，未自行计数；原工作区租约与请求有效性校验保留。 |
| `workspaceFiles.store.ts` | 保存当前有效工作区的 Git 结果，不从前后文件内容重新计算。 |
| unified parser：`renderModel/diff.ts` | 原统计依赖最多 1400 条渲染行，会少算超限补丁；`+++`／`---` 开头的实际变更内容也可能被误认成文件头。现在按 hunk 的旧／新行数量识别内容，扫描完整补丁计算统计，仅限制视觉行列表。 |
| `TurnDiffSummaryCard` | 使用完整 parser stats；文件头解析到首个 hunk 即停止，避免内容覆盖文件名。 |
| `TopBarTurnDiffMenu` | `selectReviewDiff` 明确选一个基线：工作区或原生 turn diff；不拼接、不把已有修改再次叠加。界面标题明确“相对 Git HEAD，含已有改动”。 |
| `UnifiedDiffViewer` | 使用同一个解析结果渲染行，没有另一套 full-file comparison。代码行仍有视觉截断提示，统计不再随视觉截断。 |

六个排查问题的答案：① 原计数来自人工构造的整文件补丁及其 renderer 行模型；② full-file comparison 是主因；③ CRLF/LF 不是本次主因，现在遵循 Git 自身换行转换，已测试 `core.autocrlf=false/true`；④ parser 存在独立边界缺陷，已修；⑤ 两种来源原本不是相加，现增加可测试的单一来源选择；⑥ renderer 会解析并汇总补丁，但不会再次比较完整文件，当前统计与展示行数已分开。

验证证据：

- [实际工作区单文件对照](final-validation/actual-workspace-diff.json)：renderer `add=1, del=1`，Git `1,1`。
- [全部返回文件对照](final-validation/all-returned-file-counts.json)：**32 个返回文件逐个与 Git numstat 一致**。
- [实机统计截图](final-screenshots/08-diff-1440.png)、[实机 app.handlers.ts 代码行截图](final-screenshots/08b-native-diff-lines.jpg)：一行删除、一行新增，未出现整文件替换。
- 新增 Git 临时仓库测试覆盖：单行新增、单行删除、修改一行、多文件、新文件（已暂存与未跟踪）、删除文件、existing workspace + current turn、无末尾换行、header-like 内容、CRLF、超过 1400 渲染行、子工作区。
- existing workspace + current turn 测试同时检查工作区总基线、本轮基线独立选择，以及 Git index 未被改变。测试 fixture 的 baseline commit 只发生在临时仓库，与本项目“不 commit”无关。

## B. 剩余 blocker 与已知限制

**本轮核心验收没有发现必须继续大范围开发才能修复的 blocker。** 以下限制必须随结论一起保留：

| 优先级 | 限制 | 影响／正确后续位置 |
|---|---|---|
| P1 · 范围限制 | 工作区 Diff 最多读取 32 个文件、单文件 256 KiB、总补丁 2 MiB；二进制、不安全路径等会跳过 | 计数准确性结论针对返回的文件，不能把 UI 小计当整个仓库的 `git diff --stat` 总计。UI 显示跳过数量。完整覆盖应在 `workspaceGitDiff.ts` 与共享 IPC contract 增加分页、完整 numstat 和逐文件跳过原因，而非在 renderer 猜数。 |
| P2 | Diff Viewer 最多展示 1400 行，32 项文件索引较长且不能点选直达 hunk | 完整统计保留，但长补丁阅读仍受限。后续在 viewer 做按文件定位与虚拟化；本轮不改结构。 |
| P2 | Provider 失败／检查中没有 `lastChecked` 时间数据 | 当前明确显示“暂无时间记录”，不把旧成功时间冒充失败时间。长期位置是 `ProviderRuntimeService`、`ProviderPreferencesStore` 和共享 verification DTO，补独立 checkedAt。 |
| P2 | 真实 Provider 的失败连接未人为制造 | 用无凭据 mock 与开发 harness 验证五状态；不代表真实网络和各供应商的端到端验收。 |
| P2 | 短最终回答时，已完成活动块仍稍重；复合 shell 命令摘要只显示首个命令名 | 如测试中的 `sleep … && cat …` 摘要为“执行命令 · sleep”，状态真实，但业务目的不如参考图具体。长期应从工具语义／结构化参数提取目的，不能编造“已读取”状态。 |
| P2 | 设置仍有少量旧组件痕迹与技术词 | 连接配置页保留较重卡片，更新页带开发模式英文说明，部分扩展设置表单沿用旧密度。共同导航、颜色与主面板层级一致，尚非所有内部控件完全统一。 |
| 未认证范围 | 未做完整 VoiceOver 朗读、所有主题对比度测量、全部错误路径及性能基准 | 不宣称 WCAG 全面通过，也不把工具操作耗时当应用性能指标。 |

重命名仍按原有明确策略展示为删除＋新增（Git `--no-renames`），不是 Git rename 检测视图。未跟踪文件在普通 `git diff` 中不会出现，其新增数量用 Git 空文件基准验证。

**Terminal requires separate PTY/session capability work.** 本轮未制造 Terminal，占位也未当作真实终端；Terminal 不属于本轮 UI V1 blocker。

## C. Visual QA 结果

最终代码构建后，开发进程因 main/preload 重建完整重启 Electron；本轮截图在重启后重新操作取得，未使用上一轮截图缓存。主要截图时间为本地 08:39–09:00；后续补充键盘／设置证据到 09:06。源码校验清单见 [source-sha256.json](final-validation/source-sha256.json)。

| 人工检查项 | 观察结果 |
|---|---|
| Home | “打开项目”同时出现在主行动区和顶栏；三个行动明确可见，真实打开文件夹选择器并成功加载项目。 |
| Project Ready | 品牌、项目名、完整工作区路径、已就绪文字与文件树出现，未停留在空白主面板。 |
| Chat | 用户消息有轻强调底色，AI 正文为连续阅读区域；表格与正文比折叠过程更易阅读。长用户消息仍有轻气泡感，非像素复刻。 |
| AI Running | 第一轮提交后约 2 秒内已显示“请求已提交，等待模型调度”与停止入口；后续真实 Thinking 显示当前阶段，未伪造未来完成步骤。 |
| Tool | 最终 05 截图中工具确实处于“执行中”，当前步骤有图标、文字和选中行。为确保能截到运行阶段，只读测试命令含明确的 90 秒等待；这不是模型延迟或产品性能测量。 |
| Final | 06 中真实最终回答完整显示表格；详细 Thinking/Tools/Logs 默认折叠。极短答案时活动块仍可进一步减轻。 |
| Editor / File Tree | 导航与代码区分层清楚；文件树图标、行高、选中态一致；代码使用等宽字体。长行仅在编辑器内滚动。 |
| Diff | 独立高面板覆盖工作区，Composer 不遮挡；数字、代码行均取得证据。文件列表较长是保留限制。 |
| Model | 搜索、模型、推理程度的主次可辨；失败／检查中的已配置模型保留但禁用，提供 unavailable 文字与图标。 |
| Permission | 只读／工作区／完全访问各有边界说明，Full Access 明确包含工作区外文件、运行命令及联网。未实际提升权限。 |
| Settings | 外观、服务、更新及其余十个一级入口均实际打开；共用左侧导航和内容区域。保留的旧控件差异见 B、J。 |
| macOS 原生感 | 实体窗口有单套系统红黄绿按钮，原生项目选择器、菜单缩放与窗口缩放可用；编辑器与菜单为应用自绘，不能等同于全 AppKit。 |
| 性能感知 | 常用面板与菜单切换中未观察到阻塞性冻结；模型等待有反馈，文件／Diff 加载有状态。未测 FPS、INP、内存基准。 |

## D. Responsive QA

| 尺寸 | 实际结果 |
|---|---|
| 1440 × 900 | 宽工作区中可展示文件树、对话和代码；主输入框保持紧凑。 |
| 1280 × 900 | 文件导航＋对话＋编辑器可同时阅读；内容长行在自己的区域滚动。 |
| 950 × 900 | 文件／历史面板抽屉化，编辑器仍占独立可用宽度。 |
| 700 × 900 | 双区阅读处于最紧凑状态；编辑器可读，长代码需要内部横向滚动。 |
| 560 × 900 | 转为聊天／编辑器切换，编辑器不再被强制挤成第三列。 |
| 实体窗口 560 × 711 | 另行实际拖动窗口核对；文件抽屉、编辑器标签和顶栏核心入口可操作。 |

1440 与响应式 PNG 使用 **实际 Electron renderer 的 DevTools 逻辑视口**，DPR 2；例如 1440 逻辑像素对应 2880 像素原图。不是把 1200 截图拉伸成 1440。PNG 不包含系统红黄绿，原生窗口补充 JPG 包含。设计板内各小窗口的实际逻辑尺寸未知，不能据此声称像素级对齐。

## E. Zoom QA

使用 Electron 原生 View → UI Zoom，不是浏览器截图缩放：

- 125%、150%：实际 1200 × 711 窗口，面板根据有效宽度重排；截图 18、19。
- 200%：同一实体窗口切为聊天／编辑器标签；编辑器和聊天分别截图 20、20b。输入测试文字后清空，发送、模型、权限入口均可到达。
- 额外组合：实体 560 × 711 窗口＋200%，Composer 控件分行，核心入口保留，未观察到整个 workspace 的水平滚动或越出窗口。代码／表格内部横向滚动与整个 workspace 溢出是不同情况。
- 验收结束恢复 100% 和常规窗口宽度。

## F. Accessibility checks

范围是本轮主要组件的静态检查与实际键盘操作，**不宣称 WCAG 全面通过**。

| 组件 | 验证与结果 |
|---|---|
| NavigationRail | 新对话、历史、文件、设置、Skills/MCP 均有 accessible name。实际 Space 切换文件面板，选中态随之变化；Tab 可离开按钮。 |
| StatusIndicator | 每种状态均有文字与不同图标；不是只靠颜色。任务当前状态使用 `role=status` / polite live region。静态状态文本不要求 Tab 停靠。 |
| PanelDialog / Diff | 打开焦点进入关闭按钮；Tab、Shift+Tab 在对话框内移动；Escape 关闭后回到“文件改动”按钮。原生 modal dialog 承担模态约束。 |
| Composer | 实际输入、清空文本；Tab 到 Agent，Shift+Tab 回输入区。提交任务后有等待和停止反馈。未以键盘测试为由写入项目文件。 |
| Model Picker | 修复打开后不进入菜单的问题。Enter／Space 打开后聚焦搜索；Tab 到可用模型，Shift+Tab 返回；Escape 回触发按钮。fixture 中不可用选项原生 disabled；禁止通过推理子菜单绕过禁用状态。 |
| Permission Picker | 打开进入当前选项；Tab/Shift+Tab 移动；Enter 重新选择当前只读项后回触发按钮。Escape 可关闭。没有选择 Full Access。 |
| Workspace Drawer | 实体 560 窗口中，打开进入关闭按钮；Shift+Tab 回最后复选框，Tab 再循环至关闭；Escape 后回到文件面板触发按钮。修复焦点选择器遗漏 select/textarea/summary 和原属性恢复问题。 |
| File Tree | 实际 Enter/Space 展开与收起 packages；Tab 到下一行、Shift+Tab 返回。treeitem 有层级、展开、选中信息，文件行打开后编辑器可见。 |
| Settings navigation | 每个一级入口均可选择；当前项明确选中。实际 Tab 到当前页控件、Shift+Tab 回导航、Enter/Space 激活。 |
| Reduced motion | 保留全局 `prefers-reduced-motion` 规则及组件对应规则。在 DevTools 明确启用 reduce 的同时打开真实模型菜单，焦点进入搜索且菜单可操作，保留截图 22；随后恢复默认。未测量所有旧动效的逐帧行为。 |

[模型菜单键盘观察记录](final-screenshots/model-keyboard.json) · [reduced-motion 实机证据](final-screenshots/22-reduced-motion-model.jpg)

未完成范围：VoiceOver 全流程、所有主题的量化对比度、所有动态内容的朗读顺序、全部弹出层组合。禁用模型的弱化视觉可辨，但本轮未将其认定为已完成全部对比度认证。

## G. Provider states

修复了 Chat / Home / 配置页中模型可用性判断不一致的问题。现在 store 共用 `providerPresentation` 的可选性规则；模型菜单使用独立 picker 清单，已配置但验证失败或检查中的模型仍能看见，处于禁用状态，不和正常模型等权。

| 测试状态 | Credential | Connection | Last checked | Model availability |
|---|---|---|---|---|
| Configured + Available | 已配置 | 已验证 | 后端成功验证时间 | 已启用且已选择的模型可选 |
| Configured + Unavailable | 已配置 | 服务不可用 | 暂无时间记录 | 明确不可用、禁用 |
| Configured + Validation Failed | 已配置 | 验证失败 | 暂无时间记录 | 明确不可用、禁用 |
| Not Configured | 未配置 | 不声称连接成功 | 暂无时间记录 | 不可选；设置中可配置 |
| Checking | 已配置 | 检查中 | 暂无时间记录 | 暂时禁用，保留菜单条目 |

`verified` 只代表最近一次连接验证成功，不保证此刻永不离线。configured/enabled 但尚未验证的既有路径仍允许尝试模型，并在设置显示未验证，不冒充已验证。

真实设置截图 12 展示本机已有 Codex 登录，以及开发配置中未配置的其他 Provider。未填假 API Key，未复制用户凭据，未删除或破坏真实 Provider。已有测试使用临时 mock；新增状态矩阵只构造布尔值、错误码和时间 DTO。

截图 21 来自独立 **development-only harness**，复用实际 StatusIndicator、Model Picker 与共享状态规则；画面标明“测试状态”。该 HTML 未被生产构建入口引用，不连接 preload、IPC、凭据存储或真实供应商，也没有新增产品导航入口。

## H. Test results

| 检查 | 最终结果 | 证据 |
|---|---|---|
| 相关 test suite | **12 files / 102 tests passed** | [tests-final.log](final-validation/tests-final.log) |
| Provider 五状态展示断言补充 | **1 file / 14 tests passed** | [provider-matrix-final.log](final-validation/provider-matrix-final.log) |
| `pnpm lint` | PASS | [lint-final.log](final-validation/lint-final.log) |
| `pnpm typecheck` | PASS | [typecheck-final.log](final-validation/typecheck-final.log) |
| `pnpm build` | PASS | [build.log](final-validation/build.log) |
| `pnpm branding:verify` | PASS | [branding.log](final-validation/branding.log) |
| `git diff --check` | PASS | [diff-check-final.log](final-validation/diff-check-final.log) |
| 实际工作区返回文件逐项 numstat 比对 | **32 / 32 matched** | [all-returned-file-counts.json](final-validation/all-returned-file-counts.json) |

真实记录失败与重试：首次沙箱执行中 86 项通过，2 项 Provider 本地 mock 服务器因 `listen EPERM 127.0.0.1` 无法绑定；自动批准本地测试服务权限后，相同相关套件全部通过。首次调用列表中一条 useChatRenderModel 路径不存在，最终已改为实际 composables 路径并纳入 102 项。没有通过删掉失败断言或伪造返回值得到 PASS。

后续只追加 Provider 展示断言，单独重跑该文件并再次通过 lint/typecheck/diff check；未改变已截图的产品行为。构建成功不等同于发布包在线更新测试，本轮未打包、安装、发布或 push。

## I. Screenshot index

以下为本轮重新取得的 21 项主证据：

| 编号 | 文件／状态 |
|---|---|
| 01 | [home-1440](final-screenshots/01-home-1440.png) |
| 02 | [project-ready-1440](final-screenshots/02-project-ready-1440.png) |
| 03 | [chat-1440](final-screenshots/03-chat-1440.png) |
| 04 | [thinking-live-1440](final-screenshots/04-thinking-live-1440.png) |
| 05 | [tool-live-1440](final-screenshots/05-tool-live-1440.png) — 确认真正执行中的补拍 |
| 06 | [final-answer-1440](final-screenshots/06-final-answer-1440.png) |
| 07 | [editor-1440](final-screenshots/07-editor-1440.png) |
| 08 | [diff-1440](final-screenshots/08-diff-1440.png) |
| 09 | [model-menu-1440](final-screenshots/09-model-menu-1440.png) |
| 10 | [permission-menu-1440](final-screenshots/10-permission-menu-1440.png) |
| 11 | [settings-general-1440](final-screenshots/11-settings-general-1440.png) |
| 12 | [settings-provider-1440](final-screenshots/12-settings-provider-1440.png) |
| 13 | [settings-update-1440](final-screenshots/13-settings-update-1440.png) |
| 14 | [workspace-1280](final-screenshots/14-workspace-1280.png) |
| 15 | [workspace-950](final-screenshots/15-workspace-950.png) |
| 16 | [workspace-700](final-screenshots/16-workspace-700.png) |
| 17 | [workspace-560](final-screenshots/17-workspace-560.png) |
| 18 | [zoom-125](final-screenshots/18-zoom-125.jpg) |
| 19 | [zoom-150](final-screenshots/19-zoom-150.jpg) |
| 20 | [zoom-200](final-screenshots/20-zoom-200.jpg) |
| 21 | [provider-unavailable](final-screenshots/21-provider-unavailable.png) — **测试状态** |

补充：[实体 560 窗口](final-screenshots/17b-native-window-560.jpg)、[200% 聊天](final-screenshots/20b-zoom-200-chat.jpg)、[560＋200%](final-screenshots/20c-zoom-200-window-560.jpg)、[Diff 代码行](final-screenshots/08b-native-diff-lines.jpg)、[所有设置页合图](final-screenshots/comparisons/all-settings-overview.jpg)。

03 与 06 是同一轮真实完成对话的两次独立截图，分别供整体对话与最终回答检查；没有用静态数据替换 AI 输出。05 最初抓到工具结束后的状态，已以确认执行中的截图替换；图集只引用最终有效 05。

## J. 与 Design Reference 尚存在的差异

依据用户提供的《Calmnova Code — Design System & Visual Direction V1.0》整板及 A/B/C 局部，与本轮原图组成全幅＋局部对照；[对照入口在图集每张图下方](final-screenshots/index.html)。参考板包含多种方向，实际页面没有再复制成三套主题。

- **整体重量／侧栏**：编辑模式的暗色 Rail＋文件区贴近 B；普通首页的浅灰侧栏贴近 A。实际 sidebar 220px、Rail 48px，比例不同于设计板压缩小窗，仍保持稳定边界。
- **字体与密度**：主体 UI 紧凑、代码等宽，未发现全局字体过大。历史、运行计数、文件元信息仍偏小；未用扩大所有字号掩盖层级问题。
- **Composer／圆角／边框**：保留单一浅边框输入面、约 10px 圆角，常规高度约 90px；极窄放大时允许增高。未出现全页面大圆角卡片堆叠，活动块和用户消息仍比参考 A 稍重。
- **灰度与 Accent**：白／冷灰为主，蓝紫主要用于当前操作、选中、发送按钮；用户消息有整块浅紫背景，仍有轻气泡感。没有大面积渐变或明显 Dashboard 统计卡片。
- **图标**：Rail／文件树使用一致线性图标体系；真实 C＋星品牌保留，不换成参考图中的蓝紫方块品牌。
- **AI hierarchy**：使用真实“分析／执行／结果”，没有为了匹配 C 图补造 Plan/Review/Complete 或项目洞察数字。实际 Thinking 摘要可能为英文；复合命令描述可更具体。短最终答案没有统一的显式标题，是后续微调项。
- **设置一致性**：所有一级页共用同一导航、背景和内容区；连接配置卡片、部分扩展表单、更新英文说明仍带旧样式／文案痕迹。没有在验收末尾重写这些页面。
- **Terminal**：参考 B 的终端未实现，按本轮范围明确排除，不能用视觉假终端补齐。

## K. 是否建议 commit

**建议先由人工审阅本报告和截图，再选择性 commit 本轮源码、测试和需要保留的验收文档。** 不建议无差别提交整个当前工作区：其中还保留多个早期审查目录和大量截图，这些不是本轮新功能代码。

如果人工要求的是“所有仓库文件均完整显示、所有 Provider 均真实连通、完整 WCAG 认证”，当前不满足该更广范围，应继续对应专项工作；本报告不把这些范围包装为已通过。

本次结论保持 **PASS WITH KNOWN LIMITATIONS**。已停止修改；没有 commit 或 push。
