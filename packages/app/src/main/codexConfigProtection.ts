import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";

export function sharedCodexConfigPaths(): string[] {
  return [
    ...new Set(
      [
        join(homedir(), ".codex", "config.toml"),
        join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml"),
      ].map((p) => resolve(p))
    ),
  ];
}

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    try {
      return join(await realpath(dirname(path)), basename(path));
    } catch {
      return resolve(path);
    }
  }
}

/** All renderer file/RPC writers share this boundary, including imported profiles. */
export async function assertNotSharedCodexConfig(path?: string | null): Promise<void> {
  if (!path?.trim()) throw new Error("Calmnova cannot write shared Codex configuration. Use AI provider settings.");
  const target = await canonical(path);
  for (const shared of sharedCodexConfigPaths().flatMap((p) => [p, join(dirname(p), "auth.json")])) {
    const [targetInfo, sharedInfo] = await Promise.all([
      stat(target).catch(() => null),
      stat(shared).catch(() => null),
    ]);
    const sameFile = targetInfo && sharedInfo && targetInfo.dev === sharedInfo.dev && targetInfo.ino === sharedInfo.ino;
    if (sameFile || target === (await canonical(shared))) {
      throw new Error("Calmnova cannot write shared Codex configuration. Use AI provider settings.");
    }
  }
}

export async function protectCodexConfigRpc(method: string, params: unknown): Promise<void> {
  if (!["config/value/write", "config/batchWrite"].includes(method.trim())) return;
  await assertNotSharedCodexConfig((params as { filePath?: string } | undefined)?.filePath);
}
