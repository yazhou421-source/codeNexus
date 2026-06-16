# packages/app/src/renderer/components/layout

## 目录用途

应用主布局目录，承载壳层结构、Settings 页面、侧栏与中心工作区。

## 当前内容

| 文件 / 目录                                                                                     | 说明                                     |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `TopBar`                                                                                    | 顶部栏：连接状态、工作区、主题、窗口控制 |
| `LeftSidebar`                                                                               | 左侧导航与 Settings 入口                 |
| `CenterPane`                                                                                | 聊天主工作区                             |
| `SettingsPage`                                                                              | 完整设置页                               |
| `WorkspaceEditorPane`                                                                       | 文件编辑器区域                           |
| `GlobalConfigDrawer` / `EnvSetupDrawer` / `IntegrationsDrawer` / `UpdateDrawer` | Settings 具体页内容                      |
| `left-sidebar/`                                                                                 | 工作区、Git、线程、workflow 列表         |
| `topbar/`                                                                                       | 顶部栏局部组件与样式                     |

## 维护边界

- ✅ 布局层负责组装，不做深层聚合计算
- ✅ 复杂业务卡片下沉到 `timeline/`、`workflow/`
