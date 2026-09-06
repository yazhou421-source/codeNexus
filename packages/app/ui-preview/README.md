# Renderer 组件验收

从仓库根目录启动：

```sh
pnpm --filter @codenexus/app exec vite --config ui-preview/vite.config.mjs
```

打开 `http://127.0.0.1:5199/?scene=empty`。场景：`empty`、`conversation`、`editor`、`settings`、`running`、`error`；主题参数 `theme=light|dark|pink|tech|hacker`。

预览直接挂载生产 `App.vue`，复用真实侧栏、CenterPane/ChatPane、ComposerPanel、设置页、文件树和 CodeMirror。没有复制一套展示界面。独立 Vite 根目录和模块别名仅作用于此入口，生产 `main.ts`、Vite 配置和构建输出不包含测试入口。

所有路径、会话、工具输出和示例模型服务都是固定虚构数据。测试专用桌面接口拒绝未实现的操作，设置修改只保存在内存。未初始化生产启动流程，不读取用户历史、用户配置、凭据或项目文件，不调用模型。安全存储保持不可用；设置页警告和禁用状态可见。请勿在此入口输入真实凭据。

`runtime.mjs` 仅支持测试内的新建/切换动作，其余调用不启动任务；此预览不能验证真实发送、中断、附件读取、IPC 或原生窗口行为。

## 同数据基线

```sh
UI_BASELINE=1 pnpm --filter @codenexus/app exec vite --config ui-preview/vite.config.mjs
```

打开 `http://127.0.0.1:5200/?scene=conversation`。测试插件通过 `git show` 只读获取 `c00e9b7f2b85985423dbcc7919b7058bc8218010` 的 Renderer 源码，和改后共享同一份虚构数据及接口边界。不会切分支、恢复文件、读取备份或创建 worktree。

验收时等待 Vue 异步组件及过渡完成后截图。记录实际 CSS 视口为 1440×900 或 1280×800；截图属于浏览器组件预览，不代表 Electron 原生标题栏效果。
