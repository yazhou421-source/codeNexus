# CodexBridge upstream provenance

The protocol-conversion and routing core in this package is adapted from
[CodexBridge](https://github.com/wangzhezbz/codex-bridge) under the MIT License.
The complete upstream license is preserved as `LICENSE` and is also packaged by
CodeNexus as `resources/licenses/CodexBridge-LICENSE.txt`.

- Reference checkout HEAD: `f7bf97ccd3bc1b170c4dcf13245a5e5cf78963a1`
- Last upstream commit relevant to `src/`: `0549c80074cbb2fe10a36c20c2bc99a102b4fa62`

## Source mapping

| CodexBridge                | CodeNexus Embedded Router  |
| -------------------------- | -------------------------- |
| `src/chat-to-responses.js` | `src/chat-to-responses.js` |
| `src/config.js`            | `src/config.js`            |
| `src/history.js`           | `src/history.js`           |
| `src/image-generation.js`  | `src/image-generation.js`  |
| `src/json.js`              | `src/json.js`              |
| `src/model-catalog.js`     | `src/model-catalog.js`     |
| `src/proxy.js`             | `src/proxy.js`             |
| `src/rate-limit.js`        | `src/rate-limit.js`        |
| `src/responses-to-chat.js` | `src/responses-to-chat.js` |
| `src/server.js`            | `src/server.js`            |
| `src/tools.js`             | `src/tools.js`             |
| `src/upstream.js`          | `src/upstream.js`          |

## Intentional differences

Every migrated source file has an SPDX-style license banner and is formatted by
the CodeNexus Prettier configuration. The following files also contain semantic
changes:

- `config.js`: CodeNexus naming, loopback-only listener validation,
  HTTP/HTTPS-only upstream validation, and discovery of configured secret values
  for redaction.
- `json.js`: separate compressed/decompressed request limits, early
  Content-Length rejection, bounded decompression, and safe malformed-compression
  errors.
- `server.js`: CodeNexus branding, minimal Router identity health response,
  pre-body local authentication, disabled browser CORS, request limits, and
  unified secret-safe error handling.
- `upstream.js`: unified redaction of logs and client-facing diagnostic errors.

CodeNexus-specific lifecycle, default configuration, TypeScript types, tests,
and redaction helpers are new files rather than upstream copies.

## Checking for upstream changes

From `packages/router`, run:

```sh
pnpm upstream:check
```

The developer-only script reads the sibling `bridge-reference` checkout,
verifies its expected HEAD, and compares all 12 mapped files after removing the
local license banner and normalizing formatting. It fails if a file outside the
documented semantic-change set differs. Files in the intentional-change set are
reported for manual review. Set `CODEXBRIDGE_REFERENCE_DIR` to compare another
read-only checkout. The script is not imported by, bundled into, or required by
the production Router.
