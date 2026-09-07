# Agent workspace refresh (3.2C1-Fix)

## Design and boundaries

- Reuse `workspaceFiles` directory loading; do not add a second tree or a filesystem watcher.
- Command/file-change completion, native diff updates, turn completion (including failed/interrupted), and server exit invalidate the emitting workspace. Only the visible workspace is loaded; switching to another workspace reloads its tree through the existing path.
- Coalesce events for 250 ms, serialize refresh batches, and schedule one further batch if an event arrives during a running batch. Load at most 32 visible/expanded directories. Exclude `.git`, `node_modules`, `dist`, `release`, and `.cache` from automatic expanded-directory refresh and Git status pathspecs.
- Workspace/request generations reject late directory, status, and Diff responses. Disposal cancels pending timers and invalidates in-flight results. Editor tabs, selection, and unsaved drafts are not replaced by automatic refresh.
- Main owns the active workspace grant for the main window and main frame. Grants come from a native directory picker or native confirmation when restoring an unknown history path, never from renderer-provided `cwd`, optional `workspaceRoot`, or persisted settings alone. Directory, text-file, metadata, Git status and Diff reads require that active grant; only the two exact app-owned draft/outbox files are exempt from workspace membership, with symlink checks.
- Main resolves and checks real paths before reading and before returning entries, rejecting expanded directories replaced with links outside the workspace. Grants are revoked on navigation, renderer loss and window destruction; stale leases cannot return results after a switch. Cancelling native confirmation keeps the old workspace and editor drafts. This is scoped workspace IPC hardening, not a claim that all pre-existing agent/file APIs are a renderer sandbox.
- The manual `force` option now reaches `ensureDirectoryLoaded` through `ensureDirectoryVisible`.

## Trustworthy shell Diff

The existing native turn Diff comes from Codex notifications. Shell writes do not necessarily produce these notifications. `WorkspacePatchService.readGitDiff` instead compares **Git HEAD with the current working tree**, including staged, unstaged, untracked, and pre-existing changes. It uses read-only Git status/blob reads and bounded regular-file reads. It never writes the index or inserts a fabricated native protocol event.

This is **not a per-turn snapshot**: an untracked file modified again remains an addition relative to HEAD. The menu labels this baseline explicitly. Rename is represented as deletion plus addition; whole-file replacement hunks preserve exact before/after contents rather than minimizing context lines. Native turn patches remain separately selectable; only one source is rendered at a time.

Limits: 256 KiB per before/after file, 32 changed files, 2 MiB combined Diff, 3-second timeout and bounded output per Git subprocess. Binary, invalid UTF-8, symlink, non-regular, oversized, and out-of-workspace entries are skipped. A count is shown for skipped entries. Non-Git workspaces retain automatic tree refresh but do not create a project-wide content cache. A system Git executable is required for this fallback; without it the tree still works.

## Empty thread switching

An eagerly created thread can have no persisted rollout. Queued local user messages/preparing UI do not make it resumable. Record the model used by `thread/start`; if the first send selects a different model, create a candidate thread directly with that model, then atomically move local thread/queue/draft/workspace/timeline mappings after success. On failure retain the old state and show a translated safe error. Do not resume the empty old thread. Queue flushing is serialized by both thread ID and queued message ID across replacement.

Non-empty threads retain the existing main-process provider resume/rebind implementation. No Router, Streaming, Provider Registry, Runtime/Protocol, profile, or branding changes are required.

## Verification

Authorization regressions cover arbitrary roots, missing/forged root hints, foreign senders/subframes, symlink escapes, stale leases, native cancellation and interrupted selection. The controlled GUI also verifies that real IPC rejects an unapproved Git root and directory outside the selected project.

Deterministic regression suites cover force propagation, filesystem completion events, coalescing, workspace isolation/disposal, stale responses, Git additions/modifications/deletions/renames, size/type limits, empty-thread replacement/failure, non-empty behavior, and send races. New tests were run failing before the respective fixes.

After `pnpm run build`, explicitly run the macOS controlled GUI suite:

```sh
node packages/app/scripts/workspace-agent-e2e-run.mjs --run
```

It creates an isolated temporary Git fixture and user profile, uses a random in-memory synthetic credential with a localhost upstream, and denies access to the real `.codex` directory using the macOS sandbox. It exercises the actual renderer, IPC, app-server and shell tools: first-send model switching, two consecutive turns, tree/Diff UI, rename/delete/directory updates, draft preservation, streaming deltas, and rapid empty-thread switching. Temporary profile/rollout/project files are removed after exit; only the synthetic screenshot remains for inspection. The harness is not included in production and does not run by default.

Real DeepSeek acceptance is a separate, minimal two-turn check. It must wait for the user to save a Key through the formal application UI; no old secret file, environment variable, argv value, or decryption helper is used. Passing the controlled suite alone does not claim real DeepSeek product acceptance.

### Minimal live result (2026-09-05)

After the user saved and enabled Flash through the isolated formal settings UI, both real turns completed with successful shell commands. The first created a small text fixture after switching an eager Codex thread to Flash; the second modified the same file in the same replacement thread. The tree and open Diff updated automatically. There was no `thread/resume`, no duplicate visible thread, and the workspace/history remained intact. No additional live model/streaming/native API matrix was run.

The live fixture was untracked, so its second Diff correctly remained an addition relative to HEAD with updated content, not a per-turn before/after claim. Tracked before/after behavior is covered by the controlled GUI and real-Git deterministic tests. Real credentials were removed through the formal main-process deletion API after testing, without reading their value.
