# Calmnova Code product identity migration

## Stable identity

- Product name and short name: **Calmnova Code**
- Brand: **Calmnova**
- macOS bundle identifier / Electron app ID: `com.calmnova.code`
- Windows AppUserModelId: `com.calmnova.code`
- Version remains `1.0.3` for this migration.

Internal workspace package names, Router provider/service IDs, environment variables, IPC/event names, and persisted protocol identifiers continue to use `codenexus` where changing them would break compatibility.

## User data migration

At startup, the main process sets the new Electron identity and user-data path before creating any app-owned data service. After Electron is ready—but still before `ProviderSecretStore`, `LocalSettingsService`, `HistoryStore`, or another app-data consumer is initialized—it runs migration version 1.

The old directory is retained. A successful or partial attempt writes `product-identity-migration.json` in the new profile. Known JSON stores are copied or structurally merged; entries already present in the new profile win conflicts. Unknown non-runtime files are copied to `legacy-preserved/` without overwriting. Chromium caches, lock files, and generated Router catalog data are not activated or duplicated. Symbolic links are never followed.

`~/.codex` is intentionally outside the migration roots and is neither copied nor modified.

Provider ciphertext is identity-bound on macOS and is therefore not activated by simply copying it. A short-lived, windowless Electron helper starts with the legacy `CodeNexus` credential identity, decrypts only the legacy provider store, encrypts the in-memory payload with a one-time AES-256-GCM transport key, and returns it through an anonymous pipe. The Calmnova Code process decrypts that transport payload in memory, re-encrypts each missing or invalid provider credential with its current `safeStorage` identity, and atomically writes the new store. Plaintext is never written to disk, included in the migration marker, sent to the renderer, or logged.

macOS may show a one-time Keychain authorization dialog because Keychain intentionally prevents a differently signed application identity from reading the old item without user override. A denied, locked, malformed, timed-out, or undecryptable credential produces a partial migration and third-party providers fail closed; the original CodeNexus data remains available for recovery. Partial markers are retried on the next launch, while complete markers are idempotent and skip subsequent migration.

## Release gates

- Run the packaged macOS old-identity → new-identity safeStorage smoke test with an isolated synthetic credential on every identity/signing change.
- Verify the signed upgrade's one-time Keychain authorization copy and support text. Ad-hoc builds can prompt again after rebuilds because their code identity is not stable; Electron explicitly requires consistent code signing for predictable `safeStorage` behavior.
- Run the equivalent Windows migration and DPAPI smoke test on a clean Windows 10/11 VM before release. This cannot be proven on a macOS build host.
- Test upgrade installation from the last CodeNexus installer. Changing `appId`, bundle ID, executable name, and product name can alter updater cache paths, macOS updater validation, Windows uninstall registry identity, Start Menu shortcuts, and side-by-side installation behavior.
- The publish repository intentionally remains `QinQinChina/codeNexus` in this stage. Do not publish these artifacts until the dedicated updater/repository migration is complete and old-client upgrade behavior is verified.
- Replace the inherited placeholder icon and complete macOS signing/notarization before public distribution.
