# @codenexus/router

Embedded OpenAI Responses API router for the CodeNexus Electron main process.

The protocol conversion and upstream modules in `src/*.js` are adapted from
[CodexBridge](https://github.com/wangzhezbz/codex-bridge) under its MIT license.
This package intentionally contains no CodexBridge desktop UI and has no runtime
dependency on the `bridge-reference` checkout.

The exact upstream revision, source mapping, intentional differences, and
developer comparison workflow are documented in [UPSTREAM.md](./UPSTREAM.md).
Run `pnpm upstream:check` from this package while the read-only sibling
`bridge-reference` checkout is available.

The Electron host owns startup and shutdown through `EmbeddedRouterManager`.
The built-in configuration references API-key environment variable names only;
it does not contain credentials and it does not edit Codex configuration files.

The production listener is restricted to loopback. A caller must present the
process-local Router token before a Responses request body is read. Browser
CORS is intentionally not enabled.
