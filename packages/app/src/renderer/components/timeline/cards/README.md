# packages/app/src/renderer/components/timeline/cards

## 目录用途

时间线事件卡片内容目录。

## 当前内容

| 文件                               | 说明               |
| ---------------------------------- | ------------------ |
| `FileChangeCardContent`        | 文件变更展示       |
| `WorkspaceFileSaveCardContent` | 工作区文件保存事件 |
| `McpToolCardContent`           | MCP 工具调用       |
| `McpResourceReadCardContent`   | MCP 资源读取       |
| `DynamicToolCallCardContent`   | 动态工具调用       |
| `TurnDiffSummaryCard`          | 本回合 diff 摘要   |
| `UnifiedDiffViewer`            | 统一 diff 视图     |

## 维护边界

- ✅ 组件仅消费 render model
- ✅ 新增卡片时同步补异常态与空态
