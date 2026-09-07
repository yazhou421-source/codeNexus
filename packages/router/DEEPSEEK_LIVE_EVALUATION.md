# DeepSeek live evaluation — 3.2C1

Date: 2026-09-05 (UTC). Baseline: `5780e235d66d74c22e815ca167283c67ae40dea6`.
Calmnova Code 1.0.3, Codex runtime/protocol 0.153.2, macOS arm64.
Decision: retain production Chat Completions (Path A). Native Responses (Path B)
is an opt-in evaluation, not a production route or a new Provider setting.

## Safety and reproduction

Ordinary `pnpm run ci` uses deterministic mocks and requires no live credential.
Live evaluation requires an operator, a disposable profile, and a small isolated
workspace. Never supply a credential to a script, argv, environment variable,
fixture, or report. The operator saves it in the real Provider settings UI;
existing IPC, ProviderSecretStore, Electron safeStorage, main-only resolver and
Router perform all credential handling. The model-list helper also runs in main.

The test-only builder is `packages/app/scripts/deepseek-live.mjs`. Pass an existing
directory created with `mktemp -d /private/tmp/calmnova-deepseek-3-2c1.XXXXXX`.
It emits `live-main.cjs` only there. Launch with Electron from `packages/app`,
`CODEX_HOME=<isolated-root>/codex-home` and
`--user-data-dir=<isolated-root>/user-data`. The final entry refuses other paths.
Use an OS sandbox denying reads and writes to the real `~/.codex`: CODEX_HOME
alone does not isolate every application history path. During this macOS test,
Chromium's nested sandbox conflicted with the outer sandbox; `--no-sandbox` was
used only for this disposable launch, with the outer denial still enforced.
This does not constitute packaged-app or distribution acceptance.

The builder injects access to existing main services and the native evaluation
adapter only into its temporary bundle. Production main has no such export;
the production build was checked for evaluation entry/adapter symbols.
Its stdin JSON operations are `status`, `models`, `metrics`, `path`, `ui`, `quit`.
`path` accepts `chat_completions` or `responses`, updating only this process's
DeepSeek routes. Restore it after the comparison. `ui` is a trusted local test
operator facility, not an IPC API: never inspect passwords, clipboard, auth
files/APIs, or complete configuration objects. Only inspect controlled test
workspace state and safe counters. Metrics retain only allowlisted timing and
usage fields, in memory. No captured SSE/request bodies are retained.

Choose the desired default model before creating each independent thread.
Creating a default GPT thread then forcing a third-party model after queueing can
hit the existing empty-thread `thread/resume` / missing-rollout edge case before
any Provider request. Do not count such failures as DeepSeek compatibility errors.

After testing, delete the temporary Key through the UI, verify `configured=false`,
quit normally, remove the isolated profile/CODEX_HOME/bundle, and check port 15722
and test-owned Codex children. Never decrypt a secret to verify deletion.

## Live model inventory

GET `/v1/models`, 2026-09-05T01:47:00.026Z, HTTP 200. All entries had object
`model` and owned_by `deepseek`:

- `deepseek-v4-flash`: in Registry and returned.
- `deepseek-v4-pro`: in Registry and returned.
- `deepseek-v4-flash-vision-exp`: returned but not registered.
- Registry `deepseek-r1` maps to `deepseek-reasoner`, which was not returned.

One inventory response does not prove global retirement. Registry unchanged.

## Live results

Connection test used the actual settings button: testing → verified,
verifiedAt `2026-09-05T01:43:54.746Z`. The connection-test default model is Pro;
Flash availability is independently established by its successful agent calls.

| Scenario                        | Result                                        | Requests | Input |                           Cached input | Output | Total |
| ------------------------------- | --------------------------------------------- | -------: | ----: | -------------------------------------: | -----: | ----: |
| A Flash exact short text        | 5 deltas, exact final, no duplication         |        1 |  5588 | not reliably captured before cache fix |     30 |  5618 |
| A Flash read hello.py           | tool + streamed continuation, unchanged files |        2 | 11352 |                                   5504 |     79 | 11431 |
| A Flash create/run live_test.py | file created, exit 0, output 30               |        2 | 11546 |                                   6400 |    180 | 11726 |
| A Flash same-thread modify/run  | exit 0, output 50                             |        2 | 11993 |                                  11136 |    202 | 12195 |
| A Flash after cancellation      | same thread usable, exact text                |        1 |  5660 |                                   5504 |      6 |  5666 |
| A Pro exact short text          | 5 deltas, exact final                         |        1 |  5588 |                                      0 |      6 |  5594 |
| A Pro minimal read task         | 2 commands and final text                     |        3 | 17668 |                                  11520 |    157 | 17825 |
| B Flash exact short text        | 5 deltas, exact final                         |        1 |  6534 |                                      0 |      6 |  6540 |
| B Flash read task               | 2 commands and streamed continuation          |        3 | 20050 |                                  13952 |    234 | 20284 |
| B Flash same-thread run again   | command and continuation                      |        2 | 13698 |                                  13312 |     50 | 13748 |
| B Flash after cancellation      | same thread usable, exact text                |        1 |  6606 |                                   6528 |      6 |  6612 |

These are Provider usage, not byte-based estimates. Multi-turn rows subtract the
previous cumulative turn totals. The two cancelled requests returned no final
usage; connection-test token usage was not captured. Do not interpret omissions
as zero cost. Test prompts were deliberately small; no repository-wide scan or
paid long-stream stress test was requested.

Per-request timings below are `headers / first visible-or-tool delta / complete`
in milliseconds, measured at Router, not the time for an entire tool loop.
Renderer text arrived before turn completion in all completed text scenarios.

| Scenario                      | Per-request timings (ms)                                |
| ----------------------------- | ------------------------------------------------------- |
| A Flash text                  | 246 / 611 / 612                                         |
| A Flash read                  | 237 / 494 / 590; 142 / 538 / 694                        |
| A Flash create/run            | 172 / 605 / 988; 106 / 287 / 574                        |
| A Flash second turn           | 190 / 656 / 1169; 140 / 559 / 658                       |
| A Flash cancellation recovery | 218 / 520 / 546                                         |
| A Pro text                    | 149 / 719 / 768                                         |
| A Pro read                    | 169 / 1940 / 2362; 115 / 1978 / 2165; 123 / 1263 / 1357 |
| B Flash text                  | 176 / 474 / 479                                         |
| B Flash read                  | 196 / 767 / 878; 158 / 1053 / 1097; 134 / 357 / 526     |
| B Flash second turn           | 190 / 462 / 557; 133 / 503 / 506                        |
| B Flash cancellation recovery | 186 / 366 / 392                                         |

Path A cancellation: clicked Stop after 3 deltas, interrupted in 8 ms, no later
text deltas. Path B: interrupted in 6 ms, 3 in-flight deltas arrived after the
click. Both cleared running state, recovered on the next turn, and left only the
Router listener (no active TCP connection) at the subsequent process check.
This is local closure evidence, not proof of the Provider's internal billing or
compute cancellation time. No final usage or full latency was returned on abort.

## File UI acceptance limitations

README.md and hello.py retained SHA-256, size and mtime after all read tests.
The created Python file defined addition and actually produced 30, then 50.
File creation/modification used shell commands rather than an apply_patch item.
No `turn/diff/updated` event was observed, so Diff acceptance is NOT passed.
The tree stayed stale, even after `ensureReady(true)`; explicit
`reloadTreeForThreadSwitch()` loaded and rendered the new file. Existing
`openDirectory` does not forward its `force` option into directory loading.
These are separate UI follow-ups, not fixed by this Router-only change.

## Native Responses findings

[DeepSeek's official compatibility guide](https://api-docs.deepseek.com/guides/responses_api/)
documents stateless requests (no previous_response_id), semantic SSE termination
without `[DONE]`, partial tool support, and raw reasoning rather than a generated
reasoning summary. The evaluation allowlists supported request fields, keeps
function/custom apply_patch schemas, removes unsupported cache/include fields,
and reconstructs previous_response_id from in-memory evaluation history. Missing
history fails closed. The live tool loop worked with Codex 0.153.2; other custom
tools, restart/resume history and all reasoning modes are not certified.

Reasoning item/events were removed before app-server/renderer forwarding. Native
read requests reported 427 reasoning characters in total, with no content
recorded in logs or exposed as assistant text. Completed reasoning output is also
filtered. Mock tests cover the filter and safe native error translation.

Native short text was faster in this single sample, but used 6534 input tokens
versus 5588 via Chat conversion. Tool selection/request counts also differed.
There is no statistically meaningful performance win or demonstrated overall
maintenance reduction. Retain Path A; Path B remains test-only and would need
bounded native history budgeting, restart semantics, wider tool/reasoning and
error/cancellation validation before production use.

## Errors, fixes and deterministic coverage

No natural Provider error occurred in the successful live matrix. After deleting
the real test profile, a second fresh isolated profile used a randomly generated
invalid credential entered through onboarding UI. The real connection-test
button returned `INVALID_API_KEY`, verification `failed`, verifiedAt null, and
the UI displayed “API Key 无效，请检查后重试。” with no raw HTTP status, localhost,
Router name or transport error. The real Key was never invalidated. Balance,
rate limit and unavailable-model errors remain mock-only; timeout, network,
interrupted-stream and secret-free diagnostics tests are deterministic.

Two failing regressions were established before production fixes:

1. Slow downstream allowed all 101 synthetic upstream chunks to be read despite
   backpressure. Async sequential parsing/writes now wait for drain; abort/close
   interrupts that wait and cancels the upstream reader. A localhost slow-reader
   test also observes write=false, bounds the Node write queue below 128 KiB and
   terminates before all 10,000 potential mock events are emitted.
2. A chunk without usage after the final usage chunk reset counts to zero. Update
   usage only when present, and recognize DeepSeek cache-hit/Responses details.

The backpressure fix bounds queued writes, not the final text/history needed for
the existing response object. It is not a total-output-memory-limit feature.

New deterministic suites cover safe model DTO/reconciliation/error mapping,
native request/history adaptation, reasoning redaction, native tool SSE without
DONE, cancellation during drain, and localhost backpressure. Existing suites
cover Chat deltas/multiple tools, protocol shell continuation, error codes and
secret-free diagnostics. CI after code changes: 49 files / 365 tests passed,
format, lint, protocol metadata, typecheck and production build passed.
Protocol reproduction, protocol smoke and prompt diagnostics also passed.
Live requests are never a CI dependency.

## Disposition

No Critical production issue found in this bounded evaluation. Do not declare
the complete product acceptance matrix passed: automatic file-tree/Diff and
wider online error cases remain follow-ups. Review the two production fixes and isolated
evaluation tooling as a milestone; do not switch production to Path B.
No commit or push was performed.
