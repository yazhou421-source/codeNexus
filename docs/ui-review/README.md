# Calmnova Code 第一版桌面 UI 验收

附件说明：验收截图、本机日志及统计快照仅保留在本地，不随源码提交；下文保留验收结论和场景说明。

日期：2026-09-06。起点：`c00e9b7f2b85985423dbcc7919b7058bc8218010`；分支：`feat/codex-style-ui`。开始时工作区干净，分支原先不存在。在同一目录创建分支，无 worktree、无备份恢复、无 commit、无 push。

## 参考记录与适用边界

- [官方发布文章](https://openai.com/index/introducing-the-codex-app/)：实际打开，浏览器跳转中文页面。可确认文章为 2026-02-02 的独立 Codex 桌面发布介绍，但当前正文工作区媒体未加载。
- [桌面文档入口](https://developers.openai.com/codex/app/)与[设置入口](https://developers.openai.com/codex/app/settings/)：当前分别重定向到 `learn.chatgpt.com/docs/app` 和 `learn.chatgpt.com/docs/reference/settings`。未采用其 ChatGPT/Work 布局。
- [官方 CDN 空白页图片](https://images.ctfassets.net/kftzwdyauwt9/3G8qVyVJxJ8C8QD2wcSBgw/ef4163c22cbfffc69e71e7a881a76aa8/App.png?fm=webp&q=90&w=828)：已实际查看，浅色，内容是 “Let's build”、项目选择与圆角输入区。它是局部产品示意图，不能证明完整桌面尺寸；未采用宣传背景渐变或 OpenAI 标识。
- 官方入口缺少完整可见工作区，使用[发布期第三方实机文章](https://www.learnwithmeai.com/p/gpt-53-codex-and-codex-app-one-prompt)中的[桌面截图](https://substackcdn.com/image/fetch/%24s_%21ctUb%21%2Cf_auto%2Cq_auto%3Agood%2Cfl_progressive%3Asteep/https%3A/substack-post-media.s3.amazonaws.com/public/images/9c57bf26-7617-4b68-a437-cddea1b3aa55_2556x1620.png)作为完整布局参考，已实际查看。主题浅色，可见 New thread、按项目组织的 Threads、底部 Settings、中心任务输入及右侧必要操作。以这一套独立桌面结构为工作区依据；精确应用 build 无法确认，不声称与当前官方版本像素一致。未复刻其建议卡片。

顶部 44px、侧栏偏好宽度 248px、正文最大 800px、输入框 18px 圆角及所有间距都是**本项目设计值**。深色和其他主题是既有主题机制的延伸，没有把多套官方版本混成一个布局。

## 现有区域 → 实际改造

| 区域                                               | 实现                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| App / TopBar                                       | 侧栏偏好宽度 248px，顶部增加当前任务标题；聊天、图片、流程图、论文保留原 handler，收纳到可键盘操作的次级菜单；原窗口事件保留 |
| LeftSidebar / ThreadHistoryPane                    | C + Nova 原图标及 Calmnova Code 名称、真实项目历史列表、固定设置入口；中性选中与悬停，中文标题可显示两行，运行状态保留       |
| CenterPane / EmptyState                            | 空白时提供标题、品牌和原工作区选择事件；删除重复历史卡片，历史仍在左侧；无历史时也有入口                                     |
| ChatPane                                           | 通过公共 CSS 统一正文宽度、用户消息、工具折叠、错误和代码块；无事件映射、流式或滚动业务改写                                  |
| ComposerPanel                                      | 统一圆角输入容器、工具条自动换行、中性模型/推理/权限选择器、圆形发送和独立停止按钮；补输入框可访问名称；保留原绑定           |
| SettingsPage                                       | 分类列表、返回按钮、内容宽度、表单及分隔线统一；AI 模型保持独立，配置组件及禁用/警告不变                                     |
| WorkspaceEditorPane / WorkspaceFilesSidebar / Diff | 公共主题变量统一编辑器、文件树、标签和 Diff 元信息；补关闭标签可访问名称；保留调整宽度及 Git 数据语义                        |
| Theme / Styles                                     | 浅色改为中性色，其他主题保留；去背景渐变和重阴影，统一焦点/禁用、圆角与减少动画；系统字体栈，无远程字体                      |

## 截图

全部是 **Chrome 浏览器实际组件预览**，直接挂载 App.vue，数据均虚构。不是 Electron 原生截图。内置浏览器尺寸覆盖截图出现拼接问题，因此最终截图采用 Chrome。Chrome 测试页缩放为 80%，按实测 CSS 视口校准捕获区域；导出图像为标注尺寸，未后期绘制或替换内容。右缘粉色翻译悬浮按钮属于浏览器扩展，不是产品 UI。

同尺寸、同数据改前/改后（1440×900；底部时钟显示拍摄时间）：

本地截图记录：改前会话。
本地截图记录：改后会话。

本地截图记录：新任务。
本地截图记录：模型与推理菜单。
本地截图记录：文件树与编辑器 1280×800。
本地截图记录：AI 模型设置 1280×800。
本地截图记录：通用设置 1280×800。
本地截图记录：深色工具展开 1280×800。
本地截图记录：运行中发送队列与停止控件。
本地截图记录：错误状态。

## 检查与限制

- 实测 1440×900 与 1280×800。1280×800 同时打开编辑器/文件树时无页面横向溢出，输入区完整可见，长代码在自身容器横向滚动。
- 已检查：模型菜单打开、推理切换、草稿在模式切换后保留、工具展开/折叠、菜单 Escape 关闭、设置分类与返回、编辑器键盘调整宽度、长标题、运行/停止/错误及禁用显示。
- 主题选择仍走原 store；浅色、深色截图验收。减少动画由全局媒体查询处理。没有启动真实模型任务或模型服务验证。
- 真实发送/中断、附件文件读取、队列执行、历史读写、中文输入法系统事件、真实流式长会话及原生快捷键没有做端到端运行；原绑定与业务实现保留，相关 Renderer 测试通过。
- macOS 原生交通灯、拖动区域、最大化、系统材质和窗口边距未在 Electron 验证；保留应用原有窗口控件和 IPC，不声称已复刻官方原生效果。
- 设置表单密度、部分既有小控件、底部配置/连接栏仍保留 Calmnova 的产品特性；不等同官方完整像素复刻。未检查所有扩展功能页面的像素效果。

启动方式见 `packages/app/ui-preview/README.md`。不需要 API Key。

## 最终验证结果

- 修改范围 Prettier 检查通过。
- `pnpm --filter @codenexus/app run lint` 通过。
- `pnpm run typecheck`：6 个工作区包通过；最后的 App 宽度监听调整另外执行 app tsc 和 ESLint，通过。仓库 tsc 不等同 vue-tsc 模板类型检查，实际模板通过 Vite 编译及浏览器挂载验证。
- `pnpm exec vitest run packages/app/src/renderer`：13 个测试文件、68 个测试通过，包括流式更新、队列与工作区 Diff 集成等已有断言。没有删除断言。
- `pnpm run build` 通过（Renderer、Main、Preload），测试入口未打入生产入口。未升级依赖。
- `git diff --check` 通过。
- 实际从 1280×800 调整到 1440×900 后，会话宽度从 380px 更新到 524px，编辑器从 394px 更新到 410px；无页面横向溢出。新增 ResizeObserver 仅维护布局宽度，卸载时释放。

最终 Git 状态：11 个已跟踪 Renderer 文件修改；新增 4 个模块化样式/主题文件、独立 ui-preview 目录与本验收记录/截图。无暂存，无 commit，无 push；分支仍为 `feat/codex-style-ui`，HEAD 仍为指定起点。
