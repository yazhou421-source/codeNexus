<p align="center">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="./packages/app/build/branding/app-icon-1024.png" width="112" alt="Calmnova Code app icon" />
</p>

<h1 align="center">Calmnova Code</h1>

<h3 align="center">AI Coding Workspace</h3>

<p align="center">
  Calmnova Code brings AI agent sessions, approvals, file changes, workspace context, and model services into one desktop client.
</p>

<p align="center">
  <a href="https://github.com/zhenyue6612/codeNexus/releases/latest">
    <img src="https://img.shields.io/github/v/release/zhenyue6612/codeNexus?label=release&color=2ea043" alt="Latest release" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/github/license/zhenyue6612/codeNexus?color=6e7681" alt="License" />
  </a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D4" alt="Windows" />
  <img src="https://img.shields.io/badge/Electron-40.8.5-47848F?logo=electron&logoColor=white" alt="Electron 40.8.5" />
  <img src="https://img.shields.io/badge/Vue-3.5.28-42b883?logo=vuedotjs&logoColor=white" alt="Vue 3.5.28" />
  <img src="https://img.shields.io/badge/TypeScript-5.7.3-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.7.3" />
  <img src="https://img.shields.io/badge/pnpm-10.32.1-F69220?logo=pnpm&logoColor=white" alt="pnpm 10.32.1" />
</p>

<p align="center">
  <a href="https://github.com/zhenyue6612/codeNexus/releases/latest"><strong>Download Latest Release</strong></a>
  ·
  <a href="#screenshots">Screenshots</a>
  ·
  <a href="#highlights">Highlights</a>
  ·
  <a href="#development">Development</a>
  ·
  <a href="#contributing">Contributing</a>
</p>

---

## Overview

Calmnova Code makes agentic coding practical as a self-managed desktop workspace, rather than keeping the entire workflow inside a terminal. It focuses on the parts that matter during real agent work: understanding what happened, reviewing what changed, and keeping the local workspace under the user's control.

The app handles Codex app-server notifications directly and turns them into a desktop experience with timeline review, approval handling, custom themes, custom notification sounds, workspace file browsing, and a drag-friendly editor for local files.

Calmnova Code also supports extending the agent runtime by injecting dynamic tools. The internal `codenexus.image_generate` protocol identifier is retained for backward compatibility, so image generation can appear as a native part of the conversation and timeline instead of a separate external workflow.

Calmnova Code is an independent product and is not affiliated with or endorsed by OpenAI. It is based on CodeNexus and includes an embedded router derived from CodexBridge; their MIT notices and the bundled OpenAI Codex notices are shipped with the application.

## Screenshots

Project screenshots are stored under `docs/screenshots/`.

### Chat timeline

<img src="./docs/screenshots/chat-timeline.png" alt="Calmnova Code chat timeline with planning prompt" />

### Workspace and file changes

<img src="./docs/screenshots/workspace-editor.png" alt="Calmnova Code workspace file browser and file change review" />

### Image generation workspace

<img src="./docs/screenshots/image-generation.png" alt="Calmnova Code image generation workspace" />

### Settings

<img src="./docs/screenshots/settings.png" alt="Calmnova Code global settings" />

## Recent Updates

Calmnova Code visualizes streaming output from the Codex protocol, including command/process output deltas and streaming file-change updates. This makes long-running tool calls and patch activity easier to follow while a turn is still in progress.

This capability depends on Codex experimental protocol events. Enable the streaming output experimental feature in Settings before using it.

## Highlights

| Area               | What Calmnova Code Provides                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Sessions           | Start and continue Codex threads in a persistent desktop workspace.                                          |
| Timeline           | Review protocol events, command activity, approvals, diffs, MCP calls, and system messages in context.       |
| Workspace          | Browse project files, open multiple editor tabs, save changes, and inspect agent edits visually.             |
| Approvals          | Handle command, patch, and permission requests through desktop-native review surfaces.                       |
| Settings           | Manage providers, models, skills, MCP, notifications, theme, fonts, and update behavior from one place.      |
| Windows Experience | Installer-oriented packaging, desktop window lifecycle handling, local path support, and update integration. |

## Requirements

| Dependency       | Requirement                         |
| ---------------- | ----------------------------------- |
| Operating system | Windows 10 or Windows 11            |
| Node.js          | Current LTS recommended             |
| Package manager  | `pnpm@10`                           |
| Codex runtime    | Bundled `codex-cli 0.153.2`         |
| Configuration    | CC Switch recommended for Codex CLI |

For Codex CLI provider, model, account, and environment configuration, use [CC Switch](https://github.com/farion1231/cc-switch), an all-in-one desktop manager for Claude Code, Codex, Gemini CLI, OpenCode, OpenClaw, and related agent tools.

Release builds include the pinned Codex runtime, so users do not need a system Codex CLI. For source development, prepare the bundled runtime with:

```powershell
pnpm codex:runtime:fetch -- --platform win-x64
```

## Development

Install dependencies and start the desktop app in development mode:

```powershell
pnpm install
pnpm run dev
```

Run local verification:

```powershell
pnpm run format:check
pnpm run lint
pnpm run typecheck
```

## Contributing

Contributions are welcome through pull requests. For code changes, please keep the scope focused, describe the user-facing behavior, and run the local checks before opening a PR.

Release publishing is handled by project maintainers through GitHub Actions. Contributors should not create release tags for normal PR work.

For local community discussion, a QQ group QR code can be added to the Chinese README when the image asset is available.

## Project Structure

| Path                         | Purpose                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `packages/app`               | Electron app shell, main process, preload, renderer, scripts, assets.  |
| `packages/shared`            | Cross-process base contracts, IPC channels, settings, protocol types.  |
| `packages/generated`         | Generated Codex app-server protocol types.                             |
| `packages/feature-paper`     | Paper workspace store and Vue workbench/sidebar components.            |
| `packages/feature-flowchart` | Flowchart document types, history service, workbench, and AI settings. |
| `packages/feature-imagegen`  | Image generation types, task/history services, store, and components.  |
| `pnpm-workspace.yaml`        | Workspace package membership.                                          |

## Boundaries

- Calmnova Code does not provide an OpenAI account, API token, hosted service, or model access.
- Model usage costs, workspace data handling, and local security remain the responsibility of the user.
- Third-party dependencies and bundled assets follow their respective upstream licenses.

## License and attribution

MIT. See [LICENSE](LICENSE). Calmnova Code is based on CodeNexus and includes code derived from CodexBridge, both under the MIT License. Bundled OpenAI Codex license and notice files, along with the product's third-party notice, are included in every packaged application.

The logo image currently shown in this repository is an inherited placeholder and is not the final Calmnova brand artwork.
