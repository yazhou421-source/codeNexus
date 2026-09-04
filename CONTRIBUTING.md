# Contributing

感谢关注 Calmnova Code。本项目是 AI 编程桌面工作台，贡献前请先确认改动符合项目定位：桌面端、Electron/Vue、以 Codex app-server 协议为核心。

## 开发环境

| 项目          | 要求                               |
| ------------- | ---------------------------------- |
| 操作系统      | Windows 10/11                      |
| Node.js       | 建议使用 Node.js 22 LTS            |
| 包管理器      | `pnpm@10.32.1`                     |
| Codex Runtime | 当前内置与协议生成基线为 `0.153.2` |

```powershell
pnpm install
pnpm codex:runtime:fetch -- --platform win-x64
pnpm run dev
```

## 提交前检查

提交 PR 前请至少运行：

```powershell
pnpm run ci
```

`pnpm run ci` 会依次执行格式检查、lint、类型检查和构建。较小改动也可以先运行更具体的命令：

```powershell
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run build
```

## 代码约定

- 保持改动聚焦，避免把格式化、重构和功能改动混在同一个 PR。
- 优先沿用现有目录结构、状态管理、IPC 契约和组件风格。
- 不提交本地配置、账号信息、访问令牌、生成产物或调试临时文件。
- 修改协议类型时，请说明所使用的 Codex CLI 版本，并尽量把生成结果和业务适配分开提交。
- 修改打包资源时，请同步更新 `THIRD_PARTY_NOTICES.md` 中的授权说明。

## Pull Request 要求

PR 描述应包含：

- 变更目的和主要实现方式。
- 已运行的检查命令和结果。
- 影响范围，例如主进程、preload、renderer、设置页、协议事件或打包配置。
- UI 改动请附截图或录屏；行为改动请说明复现步骤。

## Issue 建议

提交问题时请尽量提供：

- Windows 版本、Node.js 版本、pnpm 版本、Codex CLI 版本。
- 复现步骤、预期行为、实际行为。
- 相关日志或截图。

请不要在公开 issue 中粘贴 API Key、账号 Token、Cookie、私有仓库地址或本地敏感路径。
