import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { UpstreamDiagnostic } from "../../../../router/src/upstream-diagnostics.js";

/** Only accepts Router's allowlisted diagnostic record, never a request/error object. */
export class RouterDiagnosticLog {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly path: () => string) {}
  append(record: UpstreamDiagnostic): Promise<void> {
    const write = async () => {
      const path = this.path();
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      if (((await stat(path).catch(() => null))?.size ?? 0) > 256_000) {
        await rename(path, `${path}.1`);
      }
      const { timestamp, requestId, route, status, code, type, param, message, messageHash, request } = record;
      await appendFile(
        path,
        `${JSON.stringify({ timestamp, requestId, route, status, code, type, param, message, messageHash, request })}\n`,
        { mode: 0o600 }
      );
    };
    this.pending = this.pending.catch(() => undefined).then(write);
    return this.pending;
  }
}
