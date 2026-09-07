import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RouterDiagnosticLog } from "./RouterDiagnosticLog";
it("writes only diagnostic fields to a private accessible file", async () => {
  const root = await mkdtemp(join(tmpdir(), "router-diagnostic-test-"));
  try {
    const path = join(root, "logs", "router-upstream.jsonl");
    const log = new RouterDiagnosticLog(() => path);
    await log.append({
      timestamp: "fixture",
      requestId: "req_fixture",
      route: "deepseek-v4-pro",
      status: 400,
      code: "invalid_request_error",
      type: "invalid_request_error",
      param: null,
      message: "fixture",
      messageHash: "hash",
      body: "PRIVATE FILE",
      authorization: "SECRET",
    } as any);
    const text = await readFile(path, "utf8");
    expect(JSON.parse(text)).toMatchObject({ requestId: "req_fixture", status: 400 });
    expect(text).not.toMatch(/PRIVATE FILE|SECRET|authorization|body/);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
