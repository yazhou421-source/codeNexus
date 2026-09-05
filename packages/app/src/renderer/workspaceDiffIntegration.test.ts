import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("workspace Diff entry point", () => {
  it("does not label workspace changes as a turn diff for assistive technology", async () => {
    const source = await readFile(new URL("components/layout/topbar/TopBarTurnDiffMenu.vue", import.meta.url), "utf8");
    expect(source).toContain(":aria-label=\"t('topbarExtra.fileChanges')\"");
    expect(source).toContain(':aria-label="diffHeading"');
    expect(source).not.toContain(":aria-label=\"t('topbarExtra.turnDiff')\"");
  });
  it("sends the workspace boundary with directory IPC reads", async () => {
    const source = await readFile(new URL("domain/runtime/workspaceFileRuntime.ts", import.meta.url), "utf8");
    expect(source).toContain("readDirectoryViaLocalIpc(resolved.path, resolved.workspace)");
    expect(source).toContain("readDirectory({ path: dirPath, workspaceRoot })");
  });
  it("mounts the existing Diff menu in the real top bar", async () => {
    const source = await readFile(new URL("components/layout/TopBar.vue", import.meta.url), "utf8");
    expect(source).toContain("<TopBarTurnDiffMenu");
    expect(source).toContain(':open="diffOpen"');
    expect(source).toContain('import TopBarTurnDiffMenu from "./topbar/TopBarTurnDiffMenu.vue"');
  });

  it("renders only one selected Diff and retains native patches when Git has no diff", async () => {
    const source = await readFile(new URL("components/layout/topbar/TopBarTurnDiffMenu.vue", import.meta.url), "utf8");
    expect(source.match(/<UnifiedDiffViewer /g)).toHaveLength(1);
    expect(source).toContain("workspaceFilesStore.gitDiff.diffText || !currentTurnDiffText.value");
    expect(source).toContain("preferNative");
  });
});
