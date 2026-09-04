# Prompt diagnostics

Run the isolated Codex-to-Router prompt measurement from the repository root:

```sh
pnpm codex:prompt:diagnostics
```

The command uses the bundled Codex runtime, a temporary workspace containing only
`README.md` and `hello.py`, a temporary `CODEX_HOME`, random synthetic credentials,
one synthetic Skill, one localhost MCP server, and a localhost Chat Completions
upstream. It never reads the application's Provider secret store or the user's
Codex configuration. The temporary directory is removed in a `finally` block.

Default output contains categories, roles, item types, lengths, hashes, tool names,
and an explicitly labelled token estimate. It does not contain prompt text, source
code, command output, request headers, or credentials. The estimate is UTF-8 bytes
divided by four; it is not a provider tokenizer result.

The three scenarios cover a first turn with a real read-only tool call, a second
turn in the same thread, and a fresh no-tool turn. Toggle measurements remove MCP,
Skills, project instructions, history, or non-minimal tools from an in-memory
captured copy; they do not alter product defaults. Raw payloads are never written
to disk. Diagnostic reports must not be committed.
