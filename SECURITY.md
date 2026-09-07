# Security Policy

## Runtime Baseline

当前安全策略默认以内置 Codex `0.153.2` 作为 Codex CLI / app-server 协议基线。报告与 Codex CLI、app-server、动态工具、MCP 或协议事件相关的问题时，请尽量同时提供环境检测页中的 Codex 版本。

## Reporting a Vulnerability

请不要在公开 issue、PR、讨论区或截图中披露可利用细节、账号凭据、API Key、访问令牌、Cookie 或私有数据。

推荐的报告方式：

1. 优先使用 GitHub 的私有漏洞报告或 Security Advisory 功能。
2. 如果仓库暂未开启私有漏洞报告，请先用最少细节创建一个 issue，说明需要私下沟通安全问题，不要附攻击细节或敏感数据。

报告时请尽量包含：

- 受影响版本或提交。
- 影响范围，例如主进程、preload、renderer、IPC、文件系统访问、远程同步或打包配置。
- 复现条件和风险描述。
- 已验证的缓解方式或修复建议。

维护者会尽快确认问题、评估影响，并在修复后公开必要的安全说明。

## Sensitive Data

Calmnova Code 不提供 OpenAI 账号、Token 或托管服务。用户本地配置、API Key、访问令牌、工作区文件和会话历史由使用者自行管理。

贡献代码时请确认：

- 不提交 `.env`、本地配置、缓存、日志或生成产物。
- 不在测试、文档或截图中包含真实密钥。
- 新增外部请求、远程同步或文件系统能力时，默认按最小权限设计。
