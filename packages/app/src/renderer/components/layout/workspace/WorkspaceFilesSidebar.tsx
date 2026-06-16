import { Trash2 } from "lucide-react";
import type { CSSProperties, HTMLAttributes } from "react";
import { useEffect, useState } from "react";
import { normalizeAbsoluteFsPath } from "../../../domain/workspacePath";
import { useWorkspaceFilesStore } from "../../../stores/workspaceFiles.store";
import WorkspaceFileTreeView from "./WorkspaceFileTreeView";

export default function WorkspaceFilesSidebar({ className, ...props }: HTMLAttributes<HTMLElement>) {
  const store = useWorkspaceFilesStore();
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, path: "" });

  useEffect(() => {
    const close = () => setContextMenu({ visible: false, x: 0, y: 0, path: "" });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".workspace-file-context-menu")) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return (
    <aside {...props} className={["sidebar sidebar-right workspace-files-sidebar", className].filter(Boolean).join(" ")}>
      <div className="workspace-files-shell">
        <div className="workspace-files-body workspace-files-body--tree-only">
          <section className="workspace-files-section workspace-files-section--tree">
            <WorkspaceFileTreeView
              allowContextMenu
              onFileContextMenu={(path, event) => {
                const menuWidth = 176;
                const menuHeight = 44;
                const viewportPadding = 8;
                setContextMenu({
                  visible: true,
                  x: Math.max(viewportPadding, Math.min(event.clientX, window.innerWidth - menuWidth - viewportPadding)),
                  y: Math.max(viewportPadding, Math.min(event.clientY, window.innerHeight - menuHeight - viewportPadding)),
                  path: normalizeAbsoluteFsPath(path),
                });
              }}
            />
          </section>
        </div>
      </div>
      {contextMenu.visible ? (
        <div
          className="workspace-file-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y } as CSSProperties}
          role="menu"
          aria-label="文件操作"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            className="workspace-file-context-menu__item is-danger"
            type="button"
            role="menuitem"
            disabled={store.isFileDeleting(contextMenu.path)}
            onClick={() => {
              const path = normalizeAbsoluteFsPath(contextMenu.path);
              setContextMenu({ visible: false, x: 0, y: 0, path: "" });
              if (path) void store.deleteWorkspaceFile(path);
            }}
          >
            <Trash2 className="workspace-file-context-menu__icon" aria-hidden="true" />
            <span>删除文件</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}
