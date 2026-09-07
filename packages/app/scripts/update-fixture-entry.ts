// Compiled only by update-fixture.mjs. Not imported by the production entry point.
import { app, autoUpdater as nativeUpdater } from "electron";
import { autoUpdater } from "electron-updater";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { UpdateService, supportsAutomaticInstall } from "../src/main/services/UpdateService";

const root = process.env.CALMNOVA_FIXTURE_ROOT!;
if (!root?.includes("/release/update-v1-fixture-")) throw new Error("Isolated fixture root required");
const userData = join(root, "user-data");
mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
app.setPath("logs", join(root, "logs"));
const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
void app.whenReady().then(() => {
  autoUpdater.logger = null;
  const url = process.env.CALMNOVA_FIXTURE_FEED!;
  if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url)) throw new Error("Loopback-only fixture");
  autoUpdater.setFeedURL({ provider: "generic", url });
  let busy = false;
  const service = new UpdateService((state) => send({ event: "state", state }), {
    feedConfigured: true,
    updater: autoUpdater,
    canInstall: () => !busy,
    // Native probe is a separate fixture executable mode, never a production override.
    automaticInstall: process.env.CALMNOVA_FIXTURE_NATIVE === "1" ? true : undefined,
  });
  nativeUpdater.on("error", (error) => send({ event: "native-error", message: error.message }));
  nativeUpdater.on("update-downloaded", () => send({ event: "native-ready" }));
  send({
    event: "ready",
    packaged: app.isPackaged,
    version: app.getVersion(),
    automaticInstall: supportsAutomaticInstall(),
  });
  createInterface({ input: process.stdin }).on("line", async (line) => {
    const { id, op } = JSON.parse(line);
    try {
      let result: unknown;
      if (op === "check") result = await service.checkForUpdates();
      else if (op === "download") result = await service.downloadUpdate();
      else if (op === "state") result = service.getState();
      else if (op === "busy") busy = true;
      else if (op === "idle") busy = false;
      else if (op === "install") await service.quitAndInstall();
      else if (op === "quit") {
        service.dispose();
        app.quit();
      }
      send({ id, ok: true, result });
    } catch (error) {
      send({ id, ok: false, error: String(error) });
    }
  });
});
