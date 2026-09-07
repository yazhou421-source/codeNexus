import { constants } from "node:fs";
import { copyFile, lstat, open, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isCalmnovaCodexEndpoint, isCalmnovaRouterProvider } from "@codenexus/shared/codexConfigOwnership";

/** Conservative surgical edit: unfamiliar TOML constructs are left for manual review. */
export function repairCalmnovaConfigText(text: string): string {
  if (text.includes('"""') || text.includes("'''")) return text;
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const remove = new Set<number>();
  const sections: { id: string; start: number; end: number }[] = [];
  let rootEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\[/.test(lines[i])) continue;
    rootEnd = Math.min(rootEnd, i);
    if (sections.length) sections[sections.length - 1].end = i;
    const match = lines[i].match(/^\s*\[model_providers\.(codenexus-router(?:-codex)?)\]\s*(?:#.*)?\r?\n?$/);
    sections.push({ id: match?.[1] ?? "", start: i, end: lines.length });
  }
  const scalar = (line: string) =>
    line.match(/^\s*([a-z_]+)\s*=\s*(?:"([^"\\]*)"|'([^']*)'|(true|false))\s*(?:#.*)?\r?\n?$/);
  const owned = new Set<string>();
  for (const section of sections) {
    if (!section.id) continue;
    const fields = new Map<string, string>();
    let safe = true;
    for (let i = section.start + 1; i < section.end; i++) {
      if (/^\s*(?:#.*)?$/.test(lines[i])) continue;
      const match = scalar(lines[i]);
      if (
        !match ||
        fields.has(match[1]) ||
        !["name", "base_url", "wire_api", "requires_openai_auth", "env_key"].includes(match[1])
      ) {
        safe = false;
        break;
      }
      fields.set(match[1], match[2] ?? match[3] ?? match[4]);
    }
    const base = fields.get("base_url");
    const endpointOwned = section.id.endsWith("-codex")
      ? isCalmnovaCodexEndpoint(base)
      : /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/v1\/?$/.test(base ?? "") &&
        fields.get("name") === "CodeNexusRouter" &&
        fields.get("env_key") === "CODENEXUS_ROUTER_TOKEN";
    // Never remove a parent table with custom child sections.
    if (safe && endpointOwned && !text.includes(`[model_providers.${section.id}.`)) {
      owned.add(section.id);
      remove.add(section.start);
      for (let i = section.start + 1; i < section.end; i++) if (scalar(lines[i])) remove.add(i);
    }
  }
  for (let i = 0; i < rootEnd; i++) {
    const match = scalar(lines[i]);
    if (!match) continue;
    const value = match[2] ?? match[3];
    if (match[1] === "model_provider" && isCalmnovaRouterProvider(value) && owned.has(value)) remove.add(i);
    if (match[1] === "openai_base_url" && owned.size && isCalmnovaCodexEndpoint(value)) remove.add(i);
  }
  return lines.filter((_, i) => !remove.has(i)).join("");
}

export async function repairCalmnovaCodexConfig(path: string): Promise<{ repaired: boolean; backupPath?: string }> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { repaired: false };
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) return { repaired: false };
  const original = await readFile(path);
  const text = original.toString("utf8");
  if (!Buffer.from(text).equals(original)) return { repaired: false };
  const repaired = repairCalmnovaConfigText(text);
  if (repaired === text) return { repaired: false };
  const backupPath = `${path}.calmnova-repair-${randomUUID()}.bak`;
  await copyFile(path, backupPath, constants.COPYFILE_EXCL);
  // Refuse concurrent edits. The original bytes and permissions survive in the backup.
  const file = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const currentInfo = await file.stat();
    if (
      currentInfo.ino !== info.ino ||
      !(await file.readFile()).equals(original) ||
      !(await readFile(backupPath)).equals(original)
    ) {
      throw new Error("Codex configuration changed during repair; left unchanged.");
    }
    const bytes = Buffer.from(repaired);
    await file.write(bytes, 0, bytes.length, 0);
    await file.truncate(bytes.length);
    await file.sync();
  } finally {
    await file.close();
  }
  return { repaired: true, backupPath };
}
