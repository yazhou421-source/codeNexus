import { randomUUID } from "node:crypto";
import type { Model } from "@codenexus/generated/codex-app-server/v2/Model";
import type { ModelListResponse } from "@codenexus/generated/codex-app-server/v2/ModelListResponse";
import { CodexAppServer } from "../codexAppServer";
import { logger } from "../utils/logger";

/** Query the signed-in Codex catalog without the chat runtime's local catalog override. */
export class CodexModelCatalogService {
  private pending: Promise<Model[]> | null = null;

  constructor(
    private readonly createServer = () =>
      new CodexAppServer({
        id: randomUUID(),
        mode: "native",
        experimentalApiOptIn: true,
      })
  ) {}

  list(): Promise<Model[]> {
    this.pending ??= this.load().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async load(): Promise<Model[]> {
    const server = this.createServer();
    try {
      await server.start();
      const account = await server.request("account/read", { refreshToken: false });
      logger.info("codex-models", `account/read ok; type=${account.account?.type ?? "none"}`);
      if (account.account?.type !== "chatgpt") return [];
      const models = new Map<string, Model>();
      const cursors = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 12; page += 1) {
        logger.info("codex-models", `model/list rpc start; page=${page + 1}`);
        const result: ModelListResponse = await server.request("model/list", {
          cursor,
          limit: 200,
          includeHidden: false,
        });
        for (const model of result.data) {
          if (!model.hidden && model.model?.trim()) models.set(model.model, model);
        }
        cursor = result.nextCursor;
        if (!cursor) {
          logger.info(
            "codex-models",
            `model/list rpc ok; count=${models.size}; ids=${JSON.stringify([...models.keys()])}`
          );
          return [...models.values()];
        }
        if (cursors.has(cursor)) throw new Error("Repeated catalog cursor");
        cursors.add(cursor);
      }
      throw new Error("Incomplete model catalog");
    } catch {
      logger.warn("codex-models", "Account catalog RPC failed; no successful catalog replaced.");
      throw new Error("Unable to read the signed-in Codex model catalog. Please refresh and try again.");
    } finally {
      server.stop();
    }
  }
}
