# packages/app/src/renderer/components/ui

## 目录用途

跨页面复用的基础 UI 组件目录。

## 当前内容

| 文件                       | 说明                    |
| -------------------------- | ----------------------- |
| `AgentMarkdownContent` | Agent Markdown 渲染容器 |
| `Collapsible`          | 折叠面板                |
| `DetailDisclosure`     | 详情展开                |
| `LazyImageThumb`       | 图片缩略图懒加载        |
| `LoadingDots`          | 加载点动画              |
| `SelectDropdown`       | 下拉选择                |
| `WaterBallProgress`    | 水球进度条              |
| `WaveText`             | 动效文字                |

## 维护边界

- ✅ 保持低业务耦合
- ✅ 通用交互优先参数化而不是复制组件
