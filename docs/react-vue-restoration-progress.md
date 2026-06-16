# React/Vue Restoration Progress

更新日期：2026-06-13

## 目标

把渲染层从 Vue 迁移到 React 后，继续对照旧 Vue 实现还原组件效果、交互细节和运行行为。每次完成后都要继续检查是否还有需要还原的内容，直到当前证据能证明全部还原完成。

## 使用方式

1. 每轮开始先读本文档，再检查当前 worktree。
2. 对照旧 Vue 文件用 `git show HEAD:<path>.vue` 查看权威旧实现。
3. 修复后更新本文档的状态、证据和剩余项。
4. 完成一轮至少运行相关验证；大范围 UI 还原默认运行：

```powershell
pnpm --filter @codenexus/app typecheck
pnpm --filter @codenexus/app lint
pnpm --filter @codenexus/app build
rg -n "暂未恢复|后续补回|RestoredSurface|RecoveredComponent|React restored|recovered-component|restored-surface|恢复中" packages/app/src/renderer packages/feature-flowchart/src packages/feature-imagegen/src packages/feature-paper/src -g "*.tsx" -g "*.css"
```

## 判定规则

- `Done`: React 文件已经实现旧 Vue 的核心结构、状态、交互和样式入口，并通过验证。
- `Partial`: 能显示主流程，但旧 Vue 的某些细节、展开项、状态或联动仍缺失。
- `Todo`: 未审计或明显是简化替代。
- `Needs Visual QA`: 代码和构建通过，但还需要真实页面截图/交互确认。

## 当前总览

| 区域 | 状态 | 证据/备注 |
| --- | --- | --- |
| React 构建替换 Vue 启动 | Done | `App.tsx` / `main.tsx` 已存在；README、目录说明和构建配置已改为 React/Zustand 描述；当前文件树无 `.vue` 源文件。 |
| 左侧边栏 | Done | `LeftSidebar` 外壳与旧 Vue 一致；`ThreadHistoryPane`/`ThreadRow` 已补回旧版 i18n 文案、工作区分组、状态 badge、重命名/删除/提醒和空态细节；本轮修复当前线程分组自动展开 no-op action 导致的 React #185 循环，并通过真实 Electron QA 覆盖工作区/无工作区分组、问答 badge、agent nickname、running、attention、completed、清除提醒、分组折叠、删除历史和空态。 |
| 顶栏/底栏/设置页 | Done | `TopBar` 已恢复 workspace button、main view switch、Goal/Plan 摘要、更新提示、主题切换、窗口控制、面板 aria、右侧布局动画和保留菜单细节；`BottomBar` 已恢复运行模式、Codex Profile Switch、连接状态、时钟和旧版样式；`RuntimeModeChooser` 已恢复旧 Vue 首屏稳定/实验卡片、说明文案、取消规则和旧样式；`CustomWorkbench` 已补回旧 Vue 的 Provider 测试、上下文 token 芯片、工具详情展开和 composer 自动增高，真实 Electron QA 确认自定义运行时可显示且会话列表不再压叠；设置页已按旧 Vue 补回核心结构，真实 Electron QA 覆盖通用、模型配置、集成 Skills/MCP、图片生成、流程图 AI、提示音、更新、环境检测和本地保存路径；旧 Vue 中 drawer 状态未在全局壳实际挂载，已按设置页/Integrations 入口语义覆盖。 |
| Skills 面板/管理器 | Done | `SkillsPanel`/`SkillsList`/`SkillsManagerOverlay` 已恢复旧 Vue 的 `skills.*` i18n、状态分支、开关点击阻止冒泡、详情展开、固定/启用预览文案，以及内嵌页面式 manager、返回按钮、Esc 关闭和 idle 自动刷新；真实 Electron QA 确认 `/skills` 可打开 manager、真实技能列表可显示、详情展开可见且无 React runtime error；本轮 Skills 开关切换 QA 确认隔离 fixture 中 `skills/config/write` 关闭/开启均调用成功，UI checkbox 状态同步。 |
| 聊天主时间线 | Done | `ChatPane.tsx`/`ChatRowRenderer.tsx` 已恢复旧 render model；`ChatTimelineViewport.tsx` 已补回旧 Vue 虚拟滚动、行高缓存、可见锚点恢复、滚动容器 ResizeObserver、pinned user 同步和 viewport adapter；`DebugTimelineSidebar` 已恢复复用聊天时间线渲染器；真实 Electron QA 已确认空线程聊天页、长会话历史加载、`data-virtualized=true`、pinned prompt、debug timeline 和图片 lightbox 均正常。 |
| 用户消息 | Done | 已恢复 text/file/environment context、图片计数、原位 rewrite；长聊天 QA 已覆盖带图片用户消息、图片计数 tag 和 lightbox 打开。 |
| 助手消息 | Done | 已恢复 plan delta、structured final answer、memory citation；真实 Electron timeline QA 覆盖 plan 卡、结构化答复和 memory citation 展开。 |
| 命令活动 | Done | action row/session/read/list/search 已恢复旧 Vue 结构；真实 Electron timeline QA 覆盖 generic command action、command session 展开日志、read/list/search 三类 activity。 |
| MCP resource read | Done | 本轮恢复旧 Timeline card 结构、resource 名称、tool chips、参数列表、运行态和打开面板按钮；真实 Electron QA 已覆盖 MCP server 列表、resource 读取、template 参数解析、timeline 卡片和从 timeline 打开 MCP 页。 |
| MCP tool group | Done | 本轮恢复旧卡片壳、item 状态类、指标/标题/meta、raw args/result/structured/meta/schema 展开和相关资源按钮；真实 Electron timeline QA 覆盖 MCP tool group 展开和 raw detail。 |
| Dynamic tool | Done | 已对齐旧 Vue 的动态工具卡片文案、运行态 wave text、审批 badge、raw args/result 展开、图片 alt 和非状态染色规则；真实 Electron timeline QA 覆盖动态工具文本、图片和 raw args/result 展开。 |
| Image/web search/reasoning/token usage | Done | token usage 已恢复展开详情；本轮恢复 image/web search/reasoning 旧 Vue 结构、状态和展开细节；真实 Electron timeline QA 覆盖 web search、reasoning raw 和 token usage details。 |
| Composer/queue/slash command | Done | `ComposerPanel` 已恢复旧 Vue contenteditable 输入、文件 mention token、工作区文件拖放、Approval/UserInput dock、附件预览/删除、rewrite chip、模式/模型/推理/sandbox 控制、上下文水球、独立发送/停止按钮；`ApprovalDock`/`UserInputDock` 已补回旧 Vue 队列、i18n、审批决策按钮、用户输入选项键盘导航/自动聚焦/外部确认路径；`ComposerQueueList` 和 `ComposerSlashCommandList` 已恢复旧结构和 i18n。本轮真实 Electron QA 覆盖多行输入、`/skills` slash popover/manager、工作区文件拖放、图片粘贴、发送、运行中队列和停止，`tmp/composer-qa-result.json` 为 `ok=true`。 |
| Workspace/editor/MCP/settings overlays | Done | 本轮恢复 workspace file tree/sidebar/editor/icon、MCP resource panel、SettingsPage、GlobalConfigDrawer、EnvSetupDrawer、图片生成、声音、更新、Codex Profiles 设置和 Integrations 旧 Vue 细节；真实 Electron QA 已确认 workspace 选择、README 文件加载、CodeMirror 编辑、Ctrl+S 保存、文件树右键菜单、设置页 Integrations/MCP、MCP resource panel 空态/真实 server/resource/template 读取、环境检测页可显示，以及设置页本地控件保存路径；并修复 Integrations/MCP render 阶段 store 发布导致的 React recovery warning。timeline 类交互截图已由本轮 timeline QA 覆盖，drawer 状态按旧 Vue 入口语义确认。 |
| Feature packages flowchart/imagegen/paper | Done | `feature-flowchart` Workbench/AI 设置、`feature-imagegen` 三栏工作台和 `feature-paper` 三栏论文工作台均已按旧 Vue 补回核心结构、交互、i18n 和样式入口；真实 Electron QA 已确认 Flowchart 工作台、AI 生成/修改、JSON/SVG 导出、自动保存、删除当前历史重置、AI 设置入口与保存路径，Imagegen 历史加载/选择、viewer/filmstrip、缩放、API 设置入口、复制/下载、参考图/遮罩上传、生成 pending task、删除历史与设置保存路径，以及 Paper 章节选择、模式切换、研究问题/约束编辑、prompt preview 和复制提示词；证据为 `tmp/flowchart-operation-qa-result.json`、`tmp/feature-operation-qa-result.json`、`tmp/settings-save-qa-result.json`、`tmp/composer-qa-result.json`、`tmp/timeline-cards-qa-result.json` 均 `ok=true`。 |
| 文案和 Vue 残留 | Done | README、目录说明、主题说明、CSP 注释、diff 注释和 flowchart AI prompt 已清理；i18next 已配置为兼容旧 Vue `{count}` 插值格式；剩余 Vue 命中仅为旧实现对照文档、`.vue` 文件支持、代码高亮、Vue CLI 命令识别、VS Code Vue 文件图标和锁文件依赖。 |

## 本轮已完成

- 建立本文档，作为后续还原进度依据。
- 继续确认聊天区剩余缺口，定位到 `McpToolCardContent.tsx` 仍是简化实现。
- 恢复 `McpToolCardContent.tsx` 到旧 Vue 结构级别：Timeline card 外观、工具项列表、运行态波纹、formatter 文案、raw detail 展开。
- 恢复 `McpResourceReadCardContent.tsx` 到旧 Vue 结构级别：Timeline card 外观、summary、resource/tool/parameter 展示、运行态和打开 MCP 面板按钮。
- 恢复 `ChatCommandSessionCard.tsx` 到旧 Vue 结构级别：折叠日志、运行态标题、外链、停止按钮、展开按钮和聊天区样式。
- 恢复 `CommandActivityRow.tsx`、`CommandReadActivityRow.tsx`、`CommandListActivityRow.tsx`、`CommandSearchActivityRow.tsx` 到旧 Vue 结构：i18n 文案、单行 activity、运行态波纹和 list 计数 meta。
- 恢复 `ChatImageToolCard.tsx` 到旧 Vue 结构级别：状态图标、状态 badge、标题/副标题、时间戳、运行骨架屏、单图/多图网格、错误块、修订提示词和 source details。
- 恢复 `ChatWebSearchCard.tsx` 到旧 Vue 结构级别：单行 inline activity、按 actionType 切换图标、运行态波纹参数和 i18n 文案。
- 恢复 `ChatReasoningBlock.tsx` 到旧 Vue 结构级别：Brain 图标、折叠触发器、duration、二级 raw reasoning 折叠和 segment count。
- 修正 `ChatRowRenderer.tsx`：图片工具恢复 showTimestamps/formattedTime 传入；Web 搜索恢复外层 row/tool 包装；Reasoning rawText 不再用 summary text 兜底，避免无 raw 内容时误显示 raw 区。
- 清理 React 迁移后的 Vue/Pinia 过期描述：根 README/中文 README、`packages/app/src` 与 renderer/stores/theme/ui/shared 说明、CSP 注释、instruction editor 过渡注释、diff 注释和 flowchart AI system prompt。
- 复扫 Vue/Pinia 残留后确认：剩余命中均为合理保留，分别服务于旧 Vue 对照恢复文档、用户工作区 `.vue` 文件识别、Vue 代码高亮、Vue CLI 命令识别、VS Code Vue 文件图标和 `@codemirror/lang-vue` 锁文件记录。
- 恢复 `WorkspaceFileTreeView.tsx` 旧 Vue 细节：i18n 文案、未加载空态、过滤模式目录展开规则、删除/加载 meta、git title、拖拽源状态、Shift+滚轮横向滚动、深层树 min-width 和活动文件自动滚入视图。
- 修复 `WorkspaceFilesSidebar.tsx` 右键菜单：i18n label、旧版菜单尺寸/边界定位，以及点击菜单内部不被全局 pointerdown 捕获关闭。
- 恢复 `WorkspaceTreeEntryIcon.tsx` 使用 VS Code Iconify 文件/目录图标，不再退化成少量 lucide 通用图标。
- 恢复 `WorkspaceEditorPane.tsx` 旧 Vue CodeMirror 编辑器：语言高亮延迟加载、Ctrl/Meta+S 保存、每标签页 EditorState/滚动位置保留、脏标签关闭前聚焦、光标/选区/字符数状态栏、图片只读预览文案和旧版面包屑状态。
- 恢复 `McpResourcePanel.tsx` 旧 Vue 结构与行为：server 下拉、资源/模板双 tab、模板变量解析、preview/manual URI、自动读取/缓存、错误重试、thread hint、结果 resource/tool/parameter 摘要和读取态。
- 恢复 `SettingsPage.tsx` 设置页外壳：移除硬编码中文 label，接回 `settings.*` i18n、feature registry 设置 tab、feature component 渲染和未知 tab fallback。
- 恢复 `GlobalConfigDrawer.tsx` 旧 Vue 主体结构：字体/字号、语言、dirty count、模型下拉、自定义模型管理、远端模型刷新、service tier 分段控制、400K 上下文预设、上下文/压缩阈值联动校验、requirements 限制摘要、approval policy/granular flags、approvals reviewer、sandbox mode、三个 feature toggle、状态/保存 footer 与关闭/刷新/放弃前的脏数据处理。
- 恢复 `SettingsImageGenerationTab.tsx` 旧 Vue 细节：全量 i18n、input/select id、API key autocomplete、默认背景、moderation、数字 blur 归一化、mode 状态行、endpoint preview 和本地化 toast。
- 补充 `common.discard` 中英文文案，供旧版设置页 footer 使用。
- 恢复 `EnvSetupDrawer.tsx` 旧 Vue 细节：全量 i18n、busy 长文案、手动修复指引按 node/npm/codex 缺失分支、运行时提示、last result 状态类、debug hint、打开后自动检测和关闭按钮聚焦。
- 恢复 `SettingsSoundTab.tsx` 旧 Vue 细节：改回 `SelectDropdown`、全量 i18n、加载/失败/空态状态文案、试听按钮结构，以及音量拖动时仅本地更新、change 时保存。
- 恢复 `SettingsUpdateTab.tsx` 旧 Vue 细节：全量 i18n、状态 key 映射、下载进度文案、release summary、错误/说明文本和 update state 订阅清理。
- 恢复 `CodexProfilesSettingsTab.tsx` 旧 Vue 核心行为：列表/编辑器双视图、拖拽排序、新建/编辑/复制/删除/测试/状态、保存并启用、模型拉取、`config.toml`/`auth.json` 生成编辑器、自动导入当前 Codex 配置和统计信息。
- 恢复 `IntegrationsDrawer.tsx` 旧 Vue 核心行为：i18n 标题/关闭/状态 chip、Skills/MCP 工具栏、Skills Roots 目录管理、Skills compact 列表开关、Codex 配置切换器、MCP JSON 导入、MCP resource panel、MCP server 折叠列表、启停/OAuth/删除/资源查看和旧版 Integrations CSS。
- 恢复 `SettingsFlowchartAiTab.tsx` 旧 Vue 细节：`settings-card` 外壳、全量 i18n、初始快照/脏数据判断、保存按钮状态、timeout blur 归一化、状态面板、endpoint preview 和保存成功/失败 toast。
- 恢复 `FlowchartWorkbench.tsx` 旧 Vue 核心编辑能力：模板/形状/连接线/框预设、历史搜索、React Flow 拖拽画布、连线工具、撤销/重做、复制/粘贴、删除、网格排布、对齐/分布、节点/连线属性、吸附网格、AI 生成/修改、JSON/SVG 导出和保存历史。
- 恢复 `feature-imagegen` 旧 Vue 三栏结构：`ImageWorkbench.tsx` 改回中央结果查看器，补历史加载/自动选择、图片 data URL 缓存、缩放/拖拽、filmstrip、复制/下载/删除；`ImageSettingsSidebar.tsx` 改回右侧生成参数栏，补 prompt、质量竖向滑块、参考图/遮罩上传、拖拽状态、生成按钮和当前记录详情；`ImageWorkspaceSidebar.tsx` 改回左侧图片工作区，补按工作区分组、折叠、缩略图懒加载、状态、取消/重试/删除；新增 `imagegen-workbench.css` 迁回旧 scoped 样式。
- 恢复 `feature-paper` 旧 Vue 三栏结构：`PaperWorkspaceSidebar.tsx` 改回左侧论文工作区，补项目概览、进度条、章节状态条、章节备注和生成队列；`PaperWorkbench.tsx` 改回中央论文稿纸和审阅轨，补指标栏、outline grid、章节状态、草稿段落、审阅 check 卡片和响应式隐藏审阅轨；`PaperSettingsSidebar.tsx` 改回右侧生成控制，补模式按钮、研究问题/约束、引用列表、本地化 prompt preview、复制提示词和 toast；新增 `paper-workbench.css` 迁回旧 scoped 样式并做 React 全局 CSS 作用域限定。
- 复核并补齐左侧边栏旧 Vue 细节：`ThreadHistoryPane.tsx` 恢复 `threadHistory.*` i18n、无工作区 label、打开线程 aria、重命名失败 toast、本地化计数/空态/刷新按钮；`ThreadRow.tsx` 恢复 `threadRow.*` i18n、创建中 LoadingDots、重命名 aria、问答/无效 badge、清除提醒/删除历史 aria 和旧版昵称省略号。
- 复核并补齐顶栏/底栏旧 Vue 细节：`TopBar.tsx` 恢复 `TopBarWorkspaceButton`、Goal/Plan summary、UpdateNotice、ThemeSwitch、WindowControls、右侧 layout animation、面板按钮 id/aria/禁用规则；`TopBarWorkspaceButton.tsx` 恢复 basename 显示和 i18n；`TopBarGoalSummary.tsx`/`TopBarPlanSummary.tsx` 恢复下拉详情、外部点击关闭、状态/进度、goal 操作和 plan 状态；`TopBarThemeSwitch.tsx`/`TopBarUpdateNotice.tsx`/`TopBarWindowControls.tsx` 恢复旧交互；保留的 Workspace/Tools/TurnDiff 菜单也按旧 Vue 结构和 i18n 补回；`BottomBar.tsx` 和 `CodexProfileSwitch.tsx` 恢复旧版 profile switch 与底栏样式，新增 `styles/layout/bottom-bar.css`。
- 复核并补齐 Composer/queue/slash command 旧 Vue 细节：`ComposerPanel.tsx` 恢复 contenteditable 输入器、inline 文件 token、工作区文件拖放插入、Approval/UserInput dock、图片附件预览/删除、history/queue rewrite chip、执行/计划模式切换、模型/推理/sandbox 控制、service tier、上下文水球、发送按钮和运行中停止按钮；`ComposerQueueList.tsx` 恢复队列卡片状态/i18n/操作 aria；`ComposerSlashCommandList.tsx` 恢复空态和命令项 i18n。
- 恢复聊天主时间线虚拟滚动细节：`ChatTimelineViewport.tsx` 从简化列表改回旧 Vue 的 virtual threshold、overscan、行高缓存、CSS gap 度量、滚动容器 ResizeObserver、可见锚点捕获/恢复、加载历史位置保持、scroll row adapter、pinned user row 同步和虚拟行 data 属性/transform 渲染。
- 修复 React i18n 插值兼容：`i18n/index.ts` 将 i18next interpolation 前后缀调整为 `{` / `}`，恢复旧 Vue 文案文件里的 `{count}`、`{name}` 等变量渲染；轻量 Electron 截图复查确认左侧线程统计从 `总计 {count}` 恢复为 `总计 0`。
- 完成一次轻量视觉烟测：Vite 渲染层在 `http://127.0.0.1:5173` 成功加载，隐藏 Electron 截图 `tmp/visual-smoke.png` 显示首屏、左侧栏、顶栏、运行模式弹层和 Composer 布局正常；轻量脚本未加载完整 main IPC handlers，因此控制台中的 `No handler registered` 属于测试壳限制，不作为完整应用运行失败证据。
- 已按正常入口启动项目：根目录 `pnpm run dev` 正在运行，Vite 地址为 `http://127.0.0.1:5173`，dev 日志显示 bootstrap ready 且 Electron launched；stderr 仅有 esbuild watcher 正常输出。
- 对照旧 Vue 恢复首屏运行模式选择弹层：`RuntimeModeChooser.tsx` 改回旧版 `mode-chooser__panel` 结构、稳定/实验 badge、旧版标题/说明/卡片文案、首次启动不可取消规则和切换场景取消按钮；`react-recovery.css` 恢复旧 scoped 样式对应的全局版，包括 720px 面板、16px 圆角、blur backdrop、双卡 grid、accent hover/focus 和移动端单列。轻量截图 `tmp/visual-smoke-runtime-mode.png` 确认首屏弹层已显示旧版文案和布局。
- 补齐 `DynamicToolCallCardContent.tsx` 旧 Vue 细节：审批和展开标题改回 `dynamicTool.*` i18n，运行态显式保留 `cycleMaxChars={0}`，错误内容不再使用 danger 色，summary/pre 恢复 `overflow-wrap:anywhere`，图片 alt 改回 `dynamic-tool-image`，并移除 React 版英文 fallback。
- 补齐 `CustomWorkbench.tsx` 旧 Vue 细节：Provider option label 恢复 `name · kind · model`，保存条件不再强制名称，首次无可用 Provider 自动打开配置和新建表单，OpenAI 兼容连接测试按钮/成功失败文案恢复，切换 Provider/工作区后同步当前 custom session 元信息，composer 恢复 48-200px 自动增高和发送/切会话后的高度重置，上下文芯片恢复含草稿 token 的 5 格/k 文案算法，工具调用恢复 command/path/processId 摘要、长参数才展开、running 默认展开且首次点击可收起、短参数不弹详情和旧版空态/符号文案。
- 补齐 `SkillsPanel.tsx`/`SkillsList.tsx`/`SkillsManagerOverlay.tsx` 旧 Vue 细节：接回 `skills.*` i18n、空态/错误/未连接/未选工作区状态、总数/启用数、技能名称显示、固定/启用/停用预览、详情 label、checkbox 阻止冒泡、页面式 manager、刷新/返回按钮、Esc 关闭和打开时 idle 自动刷新。
- 补齐 `ApprovalDock.tsx` 旧 Vue 细节：接回 `topbarApproval.*` i18n、审批标题/队列隐藏计数、`justNow` 年龄文案、reason/grantRoot/cwd/command 信息行、本地化审批按钮、命令执行扩展决策按钮、权限审批 JSON 详情和 Guardian 诊断目标 item 传入。
- 补齐 `UserInputDock.tsx` 旧 Vue 细节：接回 `userInput.*`/`common.*` i18n、队列计数、MCP elicitation URL/空 schema 无 question 时的确认卡片、JSON schema 预览、选项按钮 ref、上下左右/Enter 键盘导航、选中项记忆、文本输入清空后恢复已选项、自动聚焦和多步上一题/下一题/提交规则。
- 补齐 `DebugTimelineSidebar.tsx` 旧 Vue 细节：标题/副标题/关闭按钮/region aria 接回 `debugTimeline.*`/`common.*` i18n，快捷键文案恢复 `Ctrl/⌘ + Alt + J`，调试侧栏不再用 MCP 风格简化列表，改回复用聊天时间线 `ChatPane` 渲染合并后的 content/debug events。
- 补齐 `CenterPaneEmptyState.tsx` 和 `ChatPlanDeltaActions.tsx` 旧 Vue 细节：空态 loading/pending/history/默认工作区文案和执行计划按钮接回 i18n，补充 `centerEmpty.defaultTitle/defaultDescription/selectWorkspace` 中英文文案。
- 补齐 `CenterPane.tsx` 旧 Vue composer 细节：推理强度、sandbox 选项/风险、service tier、上下文用量、pending thread 状态、发送/停止 title、slash command、goal/thread-content toast 和图片 lightbox 文案接回 i18n；普通 Enter 发送、Shift+Enter 换行、lightbox 关闭后回焦输入框行为恢复。
- 补齐 `ChatInlineRewriteOverlay.tsx` 旧 Vue 细节：传回 `composeFileMentions`、inline 输入 ref 聚焦、Esc/Shift+Tab/Enter 发送规则、`chat.planActions.*` i18n、`interactionOwnerId` 和 owned select popover 点击保护；`ComposerPanel`/`SelectDropdown`/model-reasoning/sandbox picker 已补 owner 透传。
- 补齐 `ChatUserBubbleFrame.tsx` 旧 Vue 气泡壳：移除错误的“你”简化标题，恢复 bubble/body/meta inline 结构。
- 补齐 `AppClosingOverlay.tsx` 旧 Vue 细节：`appClosing.*` i18n、关闭步骤 aria、本地化步骤 label、当前任务卡片、active plan/thinking 事件摘要和 task plan step 列表。
- 补齐 `GoalShutdownCountdownOverlay.tsx` 旧 Vue 文案：`goalShutdown.*` i18n、倒计时格式和取消按钮文案。
- 补齐 `GuardianReviewDiagnostics.tsx` 旧 Vue 细节：从 timeline 收集 Guardian 审批复核诊断、状态 badge、meta、当前项 badge、详情展开和 `guardianDiagnostics.*` i18n。
- 完成一轮真实主进程 Electron 视觉 QA：复用真实 `dist/main.cjs` IPC handler 路径加载 Vite 页面，发现此前“页面没有正常显示”的直接原因是 Flowchart 页面中 `@xyflow/react` 的 `StoreUpdater` 被不稳定 prop 反复触发，抛出 `Maximum update depth exceeded` 后 React 根节点清空。
- 修复 `FlowchartWorkbench.tsx`：将 `snapGrid`、`multiSelectionKeyCode` 等 ReactFlow 数组 prop 提升为稳定常量，并将 `onNodeDragStart`、`onNodeDragStop`、`onPaneClick`、`onSelectionChange` 等传给 ReactFlow 的 tracked handler 改为稳定 `useCallback`，避免 `@xyflow/react` 内部 store 每轮 render 反复 setState。
- 对照旧 Vue 补齐 `CustomWorkbench` 会话列表样式：恢复 session row 的 62px 最小高度、三行文本 block/line-height/ellipsis、删除按钮尺寸和 active/hover 状态，修复真实截图中标题、时间和 Provider meta 压叠风险。
- 真实 Electron QA 复测通过：`tmp/visual-real-initial.png`、`tmp/visual-real-custom.png`、`tmp/visual-real-settings.png` 分别确认主界面/自定义运行时/设置页可渲染，console 未再出现 React runtime error；剩余 console 仅为 Vite 连接、React DevTools 和开发态 CSP 提示。
- 本轮已通过：
  - `pnpm --filter @codenexus/app typecheck`
  - `pnpm --filter @codenexus/app lint`
  - `pnpm --filter @codenexus/app build`
  - 占位还原文案扫描无命中。
- 继续真实 Electron 视觉 QA：`tmp/visual-feature-chat.png` 确认聊天空态、左侧线程列表、Composer、顶栏/底栏可显示；`tmp/visual-feature-image.png` 确认 Imagegen 左侧历史空态、中央画布、右侧生成参数栏可显示；`tmp/visual-feature-paper-clean.png` 确认 Paper 左侧章节/队列、中央稿纸/审阅线索、右侧生成控制可显示。
- 对照旧 Vue 确认 `ImageWorkbench` store 的 `[ImageWorkbench]` console 信息、全局 feature toast 桥接、`appearance: slider-vertical` 竖向滑块写法均来自旧实现；本轮不作为 React 迁移缺口处理。首次 Imagegen 截图中的未配置 toast 为旧版自动提示，Paper 复核已等待 toast 退场后重新截图。
- 继续真实 Electron 设置页视觉 QA：覆盖 `tmp/visual-settings-global.png`、`tmp/visual-settings-profiles.png`、`tmp/visual-settings-integrations-skills.png`、`tmp/visual-settings-integrations-mcp.png`、`tmp/visual-settings-image.png`、`tmp/visual-settings-flowchart.png`、`tmp/visual-settings-sound.png`、`tmp/visual-settings-update.png`、`tmp/visual-settings-env.png`，确认主要设置 tab 均可显示。
- 修复设置页 Integrations/MCP 的 React render 阶段更新告警：`codexSkillRoots.rootsForWorkspace`、`mcpResource.getTemplateDraft` 和 `mcpResource.getResourceCacheStats` 从 Pinia 兼容 actions 调整为 getters，避免只读 helper 在 React render 中调用后触发 Zustand state publish；复测 `qaErrors` 为空。
- 修复主交互 QA 中暴露的 stale store 链路：`historyListRuntime`、`workspaceSessionRuntime`、`workspaceFiles.store` 和 `runtimeOrchestrator` 改为关键路径使用 fresh Zustand `getState()`，避免 workspace/history/config/skills/MCP 在 React 状态克隆后继续读取旧 store 对象。
- 修复 `domFallback` 对 React 动态文本的覆盖：fallback 现在只管理自己翻译过的中文原文/译文，React 写入新的非中文值时会释放跟踪，避免 topbar workspace 名称被旧中文 fallback 改回。
- 修复 React render 阶段 store 发布告警：`appShell.isThreadWorkspaceGroupCollapsed` 和 `skillsUi.isExpanded` 从兼容 actions 调整为 getters，清除主交互 QA 中的 React #185/#520 recoverable error。
- `App.tsx` shell 组件改为静态导入，减少旧 lazy asyncViews 链路在主壳层中的不确定性；`TopBarWorkspaceMenu` workspace 选择按钮 id 改为 `btn-workspace-menu-select`，避免与主选择按钮重复。
- 清理本轮临时调试日志和 probe：移除 `ReactRecoverableError` 调试输出、runtime/workspaceFiles/workspaceSession/topbar/tree probe，清理后主交互 QA 的 `messages=[]`、`actionableMessages=[]`。
- 真实主进程 Electron 主交互 QA 通过：`tmp/main-interaction-qa-result.json` 记录 `ok=true`，覆盖左侧线程重命名/删除/折叠、workspace 选择、README 文件加载、编辑保存、`/skills` manager 打开；截图为 `tmp/visual-main-interaction-debug.png`、`tmp/visual-main-interaction-left.png`、`tmp/visual-main-interaction-workspace.png`、`tmp/visual-main-interaction-skills.png`。
- 真实主进程 Electron 细节交互 QA 通过：`tmp/detail-interaction-qa-result.json` 记录 `ok=true`，覆盖文件树 README 右键菜单可见/定位在 viewport 内、菜单文案 `删除文件`、Skills manager 首项详情展开；截图为 `tmp/visual-detail-workspace-context-menu.png`、`tmp/visual-detail-skills-expanded.png`，`messages=[]`、`actionableMessages=[]`。
- 修复 `ThreadHistoryPane.tsx` 当前线程工作区分组自动展开：避免在分组未折叠时调用兼容 store action，清除长聊天 QA 首屏出现的 React #185 循环。
- 真实主进程 Electron 长聊天 QA 通过：`tmp/chat-long-qa-result.json` 记录 `ok=true`，覆盖长历史回放加载、`ChatTimelineViewport` 虚拟滚动、pinned user prompt、`Ctrl/Alt+J` 调试时间线侧栏和用户图片 lightbox；截图为 `tmp/visual-chat-long-virtual.png`、`tmp/visual-chat-long-debug.png`、`tmp/visual-chat-long-lightbox.png`。
- 真实主进程 Electron Skills 开关切换 QA 通过：`tmp/skills-toggle-qa-result.json` 记录 `ok=true`，覆盖 `/skills` manager 打开、`qa-skill` checkbox 关闭/开启、`skills/config/write` 双向持久化调用和状态刷新；截图为 `tmp/visual-skills-toggle-initial.png`、`tmp/visual-skills-toggle-disabled.png`、`tmp/visual-skills-toggle-enabled.png`。
- 真实主进程 Electron 左侧栏交互 QA 通过：`tmp/left-sidebar-qa-result.json` 记录 `ok=true`，覆盖 5 个线程、3 个分组、问答/running/attention/completed 状态、无工作区分组、agent nickname 省略、清除提醒、分组折叠、删除历史和空态；截图为 `tmp/visual-left-sidebar-statuses.png`、`tmp/visual-left-sidebar-attention-cleared.png`、`tmp/visual-left-sidebar-collapsed.png`、`tmp/visual-left-sidebar-empty.png`。
- 修复通知音在生产 CSP 下被拦截：`contentSecurityPolicy.ts` 新增 `media-src 'self' data: blob:`；重建并重跑左侧栏 QA 后 `messages=[]`、`qaErrors=[]`。
- 真实主进程 Electron MCP resource QA 通过：`tmp/mcp-resource-qa-result.json` 与 `tmp/mcp-resource-visual-qa-result.json` 均记录 `ok=true`，覆盖 MCP server/resource/template 显示、`mcp://qa/readme` 与 `mcp://qa/workspace/report.txt` 读取、timeline 外层/内层展开和“在 MCP 页打开”；可靠截图为 `tmp/visual-mcp-resource-template.png`、`tmp/visual-mcp-resource-timeline.png`、`tmp/visual-mcp-resource-open-panel.png`，`messages=[]`、`qaErrors=[]`、`actionableMessages=[]`。
- 修复 MCP resource 读取中的 stale store：`runtimeOrchestrator` 的 MCP server 和 template draft 读取改为调用最新 Zustand `getState()`，避免 runtime 初始化后继续使用旧 store 对象导致读取结果无法进入 timeline/面板。
- 真实主进程 Electron Feature 操作 QA 通过：`tmp/feature-operation-qa-result.json` 记录 `ok=true`、`qaErrors=[]`、`actionableMessages=[]`；截图 `tmp/visual-feature-image-ops.png`、`tmp/visual-feature-image-upload-generate.png`、`tmp/visual-feature-paper-ops.png` 覆盖 Imagegen 历史选择、viewer/filmstrip、缩放、复制/下载、参考图/遮罩上传、生成 pending task、删除历史，以及 Paper 章节选择、模式切换、研究问题/约束编辑、prompt preview 和复制提示词。
- 修复 `ImageSettingsSidebar.tsx` 参考图/遮罩上传：异步读取文件前先保存 `event.currentTarget`，避免 React 合成事件在 `await` 后清空导致 input reset 抛错。
- 恢复 `FlowchartWorkbench.tsx` 旧 Vue 自动保存行为：文档变更 800ms debounce 写入历史，历史加载走 `save:false`，节点拖拽结束、连线、视图移动结束触发保存，卸载前 flush pending save，删除当前历史后重置到 `basic` 模板；同时移除 React 迁移期额外手动保存按钮。
- 真实主进程 Electron Flowchart 操作 QA 通过：`tmp/flowchart-operation-qa-result.json` 记录 `ok=true`、`qaErrors=[]`、`actionableMessages=[]`；截图 `tmp/visual-flowchart-ai-ops.png`、`tmp/visual-flowchart-ai-settings.png` 覆盖真实 main IPC 路径、隔离 OpenAI Chat Completions 服务、AI 生成/修改、自动保存历史、删除当前历史重置、JSON/SVG 导出和 Flowchart AI 设置读取。
- 真实主进程 Electron 设置保存 QA 通过：`tmp/settings-save-qa-result.json` 记录 `ok=true`、`qaErrors=[]`、`actionableMessages=[]`；截图 `tmp/visual-settings-save-global.png`、`tmp/visual-settings-save-image.png`、`tmp/visual-settings-save-flowchart.png`、`tmp/visual-settings-save-sound.png` 覆盖 UI 字体/字号、Imagegen 全量设置、Flowchart AI 设置和提示音音量的本地持久化。
- 对照旧 Vue `git grep` 确认 `GlobalConfigDrawer`/`EnvSetupDrawer`/`IntegrationsDrawer` 的 drawer 状态在旧全局壳中也未实际挂载，旧版主要通过 `SettingsPage` 的 `mode="settings"` 使用；因此不作为 React 缺失挂载处理，只保留后续入口语义确认。
- 修复 React/Zustand 兼容层 stale store：`packages/app/src/renderer/stores/zustandCompat.ts`、`packages/feature-imagegen/src/renderer/zustandCompat.ts`、`packages/feature-paper/src/zustandCompat.ts` 对 `useStore(storeScope)` 返回 live `Proxy`，并用兼容 `setState` 保留 getter/action，避免 `runtimeOrchestrator`、feature runtime 等非 React 调用继续读取初始化时的旧 store 对象。
- 真实主进程 Electron Composer/queue/slash QA 通过：`tmp/composer-qa-result.json` 记录 `ok=true`、`qaErrors=[]`、`actionableMessages=[]`；截图 `tmp/visual-composer-typed.png`、`tmp/visual-composer-slash.png`、`tmp/visual-composer-slash-skills.png`、`tmp/visual-composer-attachments.png`、`tmp/visual-composer-running-queue.png` 覆盖多行输入、`/skills` slash popover/manager、工作区文件拖放、图片粘贴、发送、运行中队列和停止。stderr 中仅有沙箱外 `C:\Users\chaozheng\.codex\logs` 写入 `EPERM`，不作为 React 迁移缺口。
- 真实主进程 Electron timeline 卡片 QA 通过：`tmp/timeline-cards-qa-result.json` 记录 `ok=true`、`qaErrors=[]`、`actionableMessages=[]`；截图 `tmp/visual-timeline-assistant-details.png`、`tmp/visual-timeline-tool-cards.png`、`tmp/visual-timeline-command-activity.png`、`tmp/visual-timeline-usage-reasoning.png` 覆盖 aux activity group 展开、assistant plan/structured final/memory citation、dynamic tool 图片与 raw detail、MCP tool group、command action/session/read/list/search、reasoning raw、web search 和 token usage 展开详情。

## 下一批优先级

1. 当前总览无剩余 `Needs Visual QA` 行；后续若发现新视觉/交互缺口，继续按旧 Vue 文件对照补齐。
2. 继续保留最终复扫：类型检查、lint、构建、占位文案扫描、临时 QA 脚本扫描和 Vue 残留合理性确认。
3. 旧 drawer 状态已按入口语义确认；当前功能页已通过设置页和 Integrations 路径覆盖。

## 验证记录

| 日期 | 命令 | 结果 | 备注 |
| --- | --- | --- | --- |
| 2026-06-13 | `pnpm --filter @codenexus/app typecheck` | Pass | timeline 卡片 QA、总览收口为 Done、临时脚本删除和文档更新后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app lint` | Pass | timeline 卡片 QA、总览收口为 Done、临时脚本删除和文档更新后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app build` | Pass | timeline 卡片 QA 和文档更新后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-13 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-13 | 恢复总览未完成状态扫描 | Pass | 旧的 `Done`/`Needs Visual QA` 组合状态无命中，当前总览已全部收口为 `Done`。 |
| 2026-06-13 | 真实主进程 Electron timeline 卡片 QA | Pass | 复用真实 `dist/main.cjs` IPC handler 和生产构建；`tmp/timeline-cards-qa-result.json` 为 `ok=true`，覆盖 aux group、assistant plan/structured/memory citation、dynamic tool、MCP tool group、command action/session/read/list/search、reasoning raw、web search、token usage details，`qaErrors=[]`、`actionableMessages=[]`。 |
| 2026-06-13 | 临时 Electron QA 脚本扫描 | Pass | `rg --files -g "electron-*-qa.cjs" packages/app` 无命中，确认 timeline QA 临时脚本已删除。 |
| 2026-06-13 | `pnpm --filter @codenexus/app typecheck` | Pass | `zustandCompat` stale store 修复、Composer 真实 QA 文档入账和本轮文档更新后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app lint` | Pass | `zustandCompat` stale store 修复、Composer 真实 QA 文档入账和本轮文档更新后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app build` | Pass | `zustandCompat` stale store 修复和 Composer 真实 QA 文档入账后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-13 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-13 | 临时 Electron QA 脚本扫描 | Pass | `rg --files -g "electron-*-qa.cjs" packages/app` 无命中，确认本轮临时 QA 脚本未残留。 |
| 2026-06-13 | 真实主进程 Electron Composer/queue/slash QA | Pass | 复用真实 `dist/main.cjs` IPC handler 路径；`tmp/composer-qa-result.json` 为 `ok=true`，覆盖多行输入、`/skills` slash popover/manager、工作区文件拖放、图片粘贴、发送、运行中队列和停止，`qaErrors=[]`、`actionableMessages=[]`。 |
| 2026-06-13 | 真实主进程 Electron 设置保存 QA | Pass | 复用真实 `dist/main.cjs` IPC handler 路径加载 Vite 页面；`tmp/settings-save-qa-result.json` 为 `ok=true`，覆盖 UI 字体/字号、Imagegen 全量设置、Flowchart AI 设置和提示音音量保存，截图为 `tmp/visual-settings-save-global.png`、`tmp/visual-settings-save-image.png`、`tmp/visual-settings-save-flowchart.png`、`tmp/visual-settings-save-sound.png`。 |
| 2026-06-13 | `pnpm --filter @codenexus/app typecheck` | Pass | Flowchart 操作 QA 文档入账、临时 QA 脚本清理和本轮文档更新后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app lint` | Pass | Flowchart 操作 QA 文档入账、临时 QA 脚本清理和本轮文档更新后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app build` | Pass | Flowchart 操作 QA 文档入账后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-13 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-13 | 临时 Electron QA 脚本扫描 | Pass | `rg --files -g "electron-*-qa.cjs" packages/app` 无命中，确认本轮临时 QA 脚本未残留。 |
| 2026-06-13 | 真实主进程 Electron Flowchart 操作 QA | Pass | 复用真实 `dist/main.cjs` IPC handler 路径并使用本地 fake OpenAI Chat Completions 服务；`tmp/flowchart-operation-qa-result.json` 为 `ok=true`，覆盖 AI 生成/修改、自动保存历史、删除当前历史重置、JSON/SVG 导出和 Flowchart AI 设置读取，截图为 `tmp/visual-flowchart-ai-ops.png`、`tmp/visual-flowchart-ai-settings.png`。 |
| 2026-06-13 | `pnpm --filter @codenexus/app typecheck` | Pass | `FlowchartWorkbench` 自动保存行为恢复后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app lint` | Pass | `FlowchartWorkbench` 自动保存行为恢复后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app build` | Pass | `FlowchartWorkbench` 自动保存行为恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-13 | `pnpm --filter @codenexus/app typecheck` | Pass | `ImageSettingsSidebar` 异步 file input reset 修复、临时 QA 脚本清理和本轮文档更新后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app lint` | Pass | `ImageSettingsSidebar` 异步 file input reset 修复、临时 QA 脚本清理和本轮文档更新后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app build` | Pass | `ImageSettingsSidebar` 异步 file input reset 修复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-13 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-13 | 真实主进程 Electron Feature 操作 QA | Pass | 复用真实 `dist/main.cjs` IPC handler 路径并拦截外部操作到隔离 fixture；`tmp/feature-operation-qa-result.json` 为 `ok=true`，覆盖 Imagegen 历史/预览/上传/遮罩/生成/复制/下载/删除和 Paper 章节/模式/提示词复制，截图为 `tmp/visual-feature-image-ops.png`、`tmp/visual-feature-image-upload-generate.png`、`tmp/visual-feature-paper-ops.png`。 |
| 2026-06-13 | `pnpm --filter @codenexus/app typecheck` | Pass | MCP resource stale store 修复、CSP `media-src` 修复和本轮文档更新后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app lint` | Pass | MCP resource stale store 修复、CSP `media-src` 修复和本轮文档更新后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app build` | Pass | MCP resource stale store 修复和 CSP `media-src` 修复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-13 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-13 | 真实主进程 Electron MCP resource QA | Pass | 复用真实 `dist/main.cjs` IPC handler 路径并拦截 Codex RPC 到隔离 fixture；`tmp/mcp-resource-qa-result.json` 与 `tmp/mcp-resource-visual-qa-result.json` 为 `ok=true`，覆盖 server/resource/template、两次 `mcpServer/resource/read`、展开后的 timeline 卡片和从 timeline 打开 MCP 页，`messages=[]`、`qaErrors=[]`、`actionableMessages=[]`。 |
| 2026-06-13 | 真实主进程 Electron 左侧栏交互 QA | Pass | 复用真实 `dist/main.cjs` IPC handler 路径并拦截 Codex RPC 到隔离 fixture；`tmp/left-sidebar-qa-result.json` 为 `ok=true`，覆盖工作区/无工作区分组、问答/running/attention/completed、清除提醒、折叠、删除和空态，`messages=[]`、`qaErrors=[]`、`actionableMessages=[]`。 |
| 2026-06-13 | `pnpm --filter @codenexus/app typecheck` | Pass | CSP `media-src` 修复和左侧栏 QA 后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app lint` | Pass | CSP `media-src` 修复和左侧栏 QA 后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app build` | Pass | CSP `media-src` 修复后通过；重建后左侧栏 QA 不再出现通知音 CSP/media 警告，仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-13 | 真实主进程 Electron Skills 开关切换 QA | Pass | 复用真实 `dist/main.cjs` IPC handler 路径并拦截 Codex RPC 到隔离 fixture；`tmp/skills-toggle-qa-result.json` 为 `ok=true`，`writeCalls` 覆盖 `enabled=false` 和 `enabled=true`，`qaErrors=[]`、`actionableMessages=[]`。 |
| 2026-06-13 | 真实主进程 Electron 长聊天 QA | Pass | 复用真实 `dist/main.cjs` IPC handler 路径；长历史回放加载后 `data-virtualized=true`，渲染窗口行索引 216-251，pinned prompt 可见，debug timeline 显示 252 行，图片 lightbox 为 100%；`tmp/chat-long-qa-result.json` 为 `ok=true`，`qaErrors=[]`、`actionableMessages=[]`。 |
| 2026-06-13 | `pnpm --filter @codenexus/app typecheck` | Pass | `ThreadHistoryPane` 自动展开循环修复和长聊天 QA 后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app lint` | Pass | `ThreadHistoryPane` 自动展开循环修复和长聊天 QA 后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app build` | Pass | `ThreadHistoryPane` 自动展开循环修复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-13 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-13 | 真实主进程 Electron 主交互 QA | Pass | 复用真实 `dist/main.cjs` IPC handler 路径；线程重命名/删除/折叠、workspace 选择、README 文件加载、CodeMirror 编辑保存和 `/skills` manager 打开均通过；`tmp/main-interaction-qa-result.json` 为 `ok=true`，`messages=[]`、`actionableMessages=[]`。 |
| 2026-06-13 | 真实主进程 Electron 细节交互 QA | Pass | 复用真实 `dist/main.cjs` IPC handler 路径；文件树 README 右键菜单和 Skills 首项详情展开均通过；`tmp/detail-interaction-qa-result.json` 为 `ok=true`，截图为 `tmp/visual-detail-workspace-context-menu.png`、`tmp/visual-detail-skills-expanded.png`。 |
| 2026-06-13 | `pnpm --filter @codenexus/app typecheck` | Pass | 主交互 stale store、DOM fallback 和 Skills getter 修复后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app lint` | Pass | 主交互 stale store、DOM fallback 和 Skills getter 修复后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app build` | Pass | 主交互 stale store、DOM fallback 和 Skills getter 修复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-13 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-13 | 真实主进程 Electron Settings 视觉 QA | Pass | 复用真实 `dist/main.cjs` IPC handler 路径加载 Vite 页面；设置页通用/模型配置/Integrations Skills/Integrations MCP/图片生成/流程图 AI/提示音/更新/环境检测截图均正常，修复只读 store helper 后 `qaErrors` 为空且无加载失败。 |
| 2026-06-13 | `pnpm --filter @codenexus/app typecheck` | Pass | `codexSkillRoots`/`mcpResource` 只读 helper 从 actions 调整为 getters 后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app lint` | Pass | `codexSkillRoots`/`mcpResource` 只读 helper 从 actions 调整为 getters 后通过。 |
| 2026-06-13 | `pnpm --filter @codenexus/app build` | Pass | `codexSkillRoots`/`mcpResource` 只读 helper 从 actions 调整为 getters 后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-13 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | 真实主进程 Electron Feature 视觉 QA | Pass | 复用真实 `dist/main.cjs` IPC handler 路径加载 Vite 页面；`tmp/visual-feature-chat.png`、`tmp/visual-feature-image.png`、`tmp/visual-feature-paper-clean.png` 分别确认聊天空态、Imagegen 三栏和 Paper 三栏正常显示，`qaErrors` 为空且无加载失败。Imagegen toast、store info 日志和 slider 警告均与旧 Vue 实现一致，不作为本轮迁移缺口。 |
| 2026-06-12 | 真实主进程 Electron 视觉 QA | Pass | 复用真实 IPC handler 路径加载 Vite 页面；Flowchart 空白页修复后，`tmp/visual-real-initial.png`/`tmp/visual-real-custom.png`/`tmp/visual-real-settings.png` 显示主界面、自定义运行时和设置页正常，console 无 React runtime error。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Flowchart ReactFlow 稳定 props 与 CustomWorkbench 会话列表样式恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Flowchart ReactFlow 稳定 props 与 CustomWorkbench 会话列表样式恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Flowchart ReactFlow 稳定 props 与 CustomWorkbench 会话列表样式恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | CenterPane composer、inline rewrite、关闭/关机 overlay 与 Guardian 诊断旧 Vue 细节补齐后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | CenterPane composer、inline rewrite、关闭/关机 overlay 与 Guardian 诊断旧 Vue 细节补齐后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | CenterPane composer、inline rewrite、关闭/关机 overlay 与 Guardian 诊断旧 Vue 细节补齐后通过；仍仅有既存 Vite 动/静态 import chunk 警告，本轮 Guardian 诊断静态复用命中同类提示。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Debug timeline/Center empty/Plan actions 旧 Vue 细节补齐后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Debug timeline/Center empty/Plan actions 旧 Vue 细节补齐后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Debug timeline/Center empty/Plan actions 旧 Vue 细节补齐后通过；仍仅有既存 Vite 动/静态 import chunk 警告，DebugTimelineSidebar 复用 ChatPane 后命中同类提示。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Approval/UserInput dock 旧 Vue 细节补齐后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Approval/UserInput dock 旧 Vue 细节补齐后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Approval/UserInput dock 旧 Vue 细节补齐后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Skills 面板/列表/管理器旧 Vue 细节补齐后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Skills 面板/列表/管理器旧 Vue 细节补齐后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Skills 面板/列表/管理器旧 Vue 细节补齐后通过；仍仅有既存 Vite 动/静态 import chunk 警告，新增 SkillsManagerOverlay 命中同类提示。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | CustomWorkbench 细节补齐后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | CustomWorkbench 细节补齐后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | CustomWorkbench 细节补齐后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Dynamic tool 文案/样式细节补齐后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Dynamic tool 文案/样式细节补齐后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Dynamic tool 文案/样式细节补齐后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | RuntimeModeChooser 首屏弹层恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | RuntimeModeChooser 首屏弹层恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | RuntimeModeChooser 首屏弹层恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | 轻量 Electron 视觉烟测 | Pass | `tmp/visual-smoke-runtime-mode.png` 显示旧版稳定/实验卡片、说明文案和居中面板，无明显重叠。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | i18n 插值兼容修复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | i18n 插值兼容修复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | i18n 插值兼容修复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | 轻量 Electron 视觉烟测 | Pass | Vite 渲染层首屏截图成功，`总计 0` 插值正常；测试壳未注册 main IPC handlers，相关控制台错误需在完整 `pnpm run dev` 窗口中复核。 |
| 2026-06-12 | `pnpm run dev` | Pass | 正常开发入口已启动，Vite `127.0.0.1:5173` ready，Electron launched；日志未见启动失败。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | 聊天主时间线虚拟滚动恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | 聊天主时间线虚拟滚动恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | 聊天主时间线虚拟滚动恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | 左侧栏、顶栏/底栏细节恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | 左侧栏、顶栏/底栏细节恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | 左侧栏、顶栏/底栏细节恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Composer/queue/slash command 代码级恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Composer/queue/slash command 代码级恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Composer/queue/slash command 代码级恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Paper 三栏论文工作台恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Paper 三栏论文工作台恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Paper 三栏论文工作台恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Imagegen 三栏工作台恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Imagegen 三栏工作台恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Imagegen 三栏工作台恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Flowchart Workbench/AI 设置恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Flowchart Workbench/AI 设置恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Flowchart Workbench/AI 设置恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Integrations 抽屉恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Integrations 抽屉恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Integrations 抽屉恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Codex Profiles 设置恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Codex Profiles 设置恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Codex Profiles 设置恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | 上一轮聊天区恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | 上一轮聊天区恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | 仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | MCP tool card 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | MCP tool card 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | MCP tool card 恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | MCP resource read card 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | MCP resource read card 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | MCP resource read card 恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Command session card 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Command session card 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Command session card 恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Command read/list/search 活动行恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Command read/list/search 活动行恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Command read/list/search 活动行恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Image/web search/reasoning 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Image/web search/reasoning 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Image/web search/reasoning 恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | Vue/Pinia 残留扫描 | Pass | 剩余命中均为恢复文档、`.vue` 文件支持/高亮/图标/命令识别或锁文件记录，非迁移残留。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | 文档/注释/prompt 清理后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | 文档/注释/prompt 清理后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | 文档/注释/prompt 清理后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | Workspace file tree/editor 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | Workspace file tree/editor 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | Workspace file tree/editor 恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | MCP resource panel 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | MCP resource panel 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | MCP resource panel 恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | SettingsPage/GlobalConfigDrawer/SettingsImageGenerationTab 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | SettingsPage/GlobalConfigDrawer/SettingsImageGenerationTab 恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | SettingsPage/GlobalConfigDrawer/SettingsImageGenerationTab 恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
| 2026-06-12 | `pnpm --filter @codenexus/app typecheck` | Pass | EnvSetup/Sound/Update 设置恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app lint` | Pass | EnvSetup/Sound/Update 设置恢复后通过。 |
| 2026-06-12 | `pnpm --filter @codenexus/app build` | Pass | EnvSetup/Sound/Update 设置恢复后通过；仍仅有既存 Vite 动/静态 import chunk 警告。 |
| 2026-06-12 | 占位还原文案扫描 | Pass | `rg` 无命中，退出码 1 表示未找到匹配。 |
