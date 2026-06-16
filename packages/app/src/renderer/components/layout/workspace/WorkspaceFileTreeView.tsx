import { ChevronRight } from "lucide-react";
import type { CSSProperties, HTMLAttributes, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceGitStatusEntry } from "@codenexus/shared/ipc/contracts";
import { basenameFromPath } from "../../../domain/workspaceFiles";
import { normalizeAbsoluteFsPath } from "../../../domain/workspacePath";
import { writeWorkspaceFileDragData } from "../../../domain/workspaceFileDrag";
import { useWorkspaceFilesStore } from "../../../stores/workspaceFiles.store";
import WorkspaceTreeEntryIcon from "./WorkspaceTreeEntryIcon";

export type WorkspaceFileTreeViewProps = HTMLAttributes<HTMLDivElement> & {
  filterText?: string;
  allowContextMenu?: boolean;
  onFileContextMenu?: (path: string, event: ReactMouseEvent) => void;
};

type TreeRow =
  | {
      kind: "entry";
      key: string;
      path: string;
      label: string;
      depth: number;
      isDirectory: boolean;
      isExpanded: boolean;
      isLoading: boolean;
      isActiveFile: boolean;
      isSelectedDirectory: boolean;
      gitStatus: WorkspaceGitStatusEntry | null;
    }
  | { kind: "message"; key: string; path: string; text: string; depth: number; tone: "dim" | "error" };

export default function WorkspaceFileTreeView({
  filterText = "",
  allowContextMenu = false,
  onFileContextMenu,
  className,
  ...props
}: WorkspaceFileTreeViewProps) {
  const store = useWorkspaceFilesStore();
  const treeSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [draggingTreePath, setDraggingTreePath] = useState("");
  const normalizedFilter = filterText.trim().toLowerCase();
  const hasFilter = normalizedFilter.length > 0;

  useEffect(() => {
    void store.ensureReady(false);
  }, [store.workspacePath]);

  const rows = useMemo<TreeRow[]>(() => {
    const workspace = normalizeAbsoluteFsPath(store.workspacePath);
    if (!workspace) return [];
    const includesFilter = (path: string, label: string) => {
      if (!hasFilter) return true;
      return path.toLowerCase().includes(normalizedFilter) || label.toLowerCase().includes(normalizedFilter);
    };
    const appendDirectory = (path: string, label: string, depth: number): TreeRow[] => {
      const normalizedPath = normalizeAbsoluteFsPath(path);
      const isExpanded = hasFilter ? true : store.isDirectoryExpanded(normalizedPath);
      const entryRow: TreeRow = {
        kind: "entry",
        key: `dir:${normalizedPath}`,
        path: normalizedPath,
        label,
        depth,
        isDirectory: true,
        isExpanded,
        isLoading: store.isDirectoryLoading(normalizedPath),
        isActiveFile: false,
        isSelectedDirectory: normalizeAbsoluteFsPath(store.directoryPath) === normalizedPath,
        gitStatus: store.gitStatusForDirectory(normalizedPath),
      };
      const children: TreeRow[] = [];
      if (isExpanded) {
        const errorText = store.directoryErrorByPath(normalizedPath);
        if (errorText && (!hasFilter || includesFilter(normalizedPath, errorText))) {
          children.push({ kind: "message", key: `direrr:${normalizedPath}`, path: normalizedPath, text: errorText, depth: depth + 1, tone: "error" });
        }
        const entries = store.directoryEntriesByPath(normalizedPath);
        if (entries.length === 0 && !entryRow.isLoading && !errorText && !hasFilter) {
          children.push({ kind: "message", key: `dirempty:${normalizedPath}`, path: normalizedPath, text: "空目录", depth: depth + 1, tone: "dim" });
        }
        for (const entry of entries) {
          if (entry.isDirectory) {
            const nested = appendDirectory(entry.path, entry.fileName, depth + 1);
            if (!hasFilter || nested.length > 1 || includesFilter(entry.path, entry.fileName)) children.push(...nested);
            continue;
          }
          if (!includesFilter(entry.path, entry.fileName)) continue;
          children.push({
            kind: "entry",
            key: `file:${entry.path}`,
            path: entry.path,
            label: entry.fileName,
            depth: depth + 1,
            isDirectory: false,
            isExpanded: false,
            isLoading: false,
            isActiveFile: normalizeAbsoluteFsPath(store.activeFilePath) === normalizeAbsoluteFsPath(entry.path),
            isSelectedDirectory: false,
            gitStatus: store.gitStatusForPath(entry.path),
          });
        }
      }
      if (hasFilter && depth > 0 && !includesFilter(normalizedPath, label) && children.length === 0) return [];
      return [entryRow, ...children];
    };
    const result = appendDirectory(workspace, basenameFromPath(workspace) || workspace, 0);
    if (hasFilter && result.length === 1) {
      result.push({ kind: "message", key: `filter-empty:${workspace}`, path: workspace, text: "未匹配到文件", depth: 1, tone: "dim" });
    }
    return result;
  }, [
    hasFilter,
    normalizedFilter,
    store.workspacePath,
    store.directoryPath,
    store.activeFilePath,
    store.expandedDirectoryPaths,
    store.treeEntriesByPath,
    store.treeLoadingPaths,
    store.treeErrorTextByPath,
    store.gitStatusByPath,
  ]);

  const maxTreeDepth = rows.reduce((maxDepth, row) => (row.depth > maxDepth ? row.depth : maxDepth), 0);
  const horizontalDepthOverflow = Math.max(0, maxTreeDepth - 8);
  const treeContentStyle = {
    minWidth: horizontalDepthOverflow > 0 ? `calc(100% + ${horizontalDepthOverflow * 14}px)` : "100%",
  } as CSSProperties;

  const treeRowMetaText = (row: Extract<TreeRow, { kind: "entry" }>) => {
    if (store.isFileDeleting(row.path)) return "删除中";
    if (row.isLoading) return "加载中";
    return "";
  };

  const gitStatusTitle = (row: Extract<TreeRow, { kind: "entry" }>) => {
    if (!row.gitStatus) return "";
    return `${row.gitStatus.code} ${row.gitStatus.relativePath}`;
  };

  const treeRowTitle = (row: Extract<TreeRow, { kind: "entry" }>) => {
    const gitText = gitStatusTitle(row);
    return gitText ? `${row.label}\n${row.path}\n${gitText}` : `${row.label}\n${row.path}`;
  };

  const onTreeSurfaceWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const surface = treeSurfaceRef.current;
    if (!surface || !event.shiftKey || event.deltaY === 0) return;
    const maxScrollLeft = surface.scrollWidth - surface.clientWidth;
    if (maxScrollLeft <= 0) return;
    event.preventDefault();
    surface.scrollLeft = Math.max(0, Math.min(maxScrollLeft, surface.scrollLeft + event.deltaY));
  };

  useEffect(() => {
    const targetPath = normalizeAbsoluteFsPath(store.activeFilePath);
    const surface = treeSurfaceRef.current;
    if (!targetPath || !surface) return;
    const row = surface.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(targetPath)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [store.activeFilePath, rows.length, store.directoryPath, hasFilter]);

  return (
    <div
      {...props}
      ref={treeSurfaceRef}
      className={["workspace-files-tree-surface app-scrollbar", className].filter(Boolean).join(" ")}
      role="tree"
      aria-label="工作区文件树"
      onWheel={(event) => {
        props.onWheel?.(event);
        if (!event.defaultPrevented) onTreeSurfaceWheel(event);
      }}
    >
      {!store.hasWorkspace ? (
        <div className="workspace-files-placeholder">先选择工作区后再浏览文件。</div>
      ) : rows.length === 0 ? (
        <div className="workspace-files-placeholder">工作区尚未加载。</div>
      ) : (
      <div className="workspace-files-tree-content" style={treeContentStyle}>
        {rows.map((row) => {
          if (row.kind === "message") {
            return (
              <div
                key={row.key}
                className={["workspace-file-tree-message", row.tone === "error" ? "is-error" : "is-dim"].join(" ")}
                style={{ paddingLeft: 24 + row.depth * 14 } as CSSProperties}
              >
                {row.text}
              </div>
            );
          }
          return (
            <button
              key={row.key}
              className={[
                "workspace-file-tree-row",
                row.depth === 0 ? "is-root" : "",
                row.isDirectory ? "is-directory" : "is-file",
                row.isActiveFile ? "is-active-file" : "",
                row.isSelectedDirectory ? "is-selected-directory" : "",
                store.isFileDeleting(row.path) ? "is-deleting" : "",
                draggingTreePath === normalizeAbsoluteFsPath(row.path) ? "is-drag-source" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ paddingLeft: 10 + row.depth * 14 } as CSSProperties}
              type="button"
              role="treeitem"
              draggable
              aria-level={row.depth + 1}
              aria-expanded={row.isDirectory ? row.isExpanded : undefined}
              aria-selected={row.isActiveFile || row.isSelectedDirectory}
              data-tree-path={row.path}
              title={treeRowTitle(row)}
              onClick={() => {
                if (store.isFileDeleting(row.path)) return;
                if (row.isDirectory) {
                  if (hasFilter) return;
                  void store.toggleDirectoryExpanded(row.path);
                }
                else void store.openFile(row.path);
              }}
              onContextMenu={(event) => {
                if (!allowContextMenu || row.isDirectory || store.isFileDeleting(row.path)) return;
                event.preventDefault();
                event.stopPropagation();
                onFileContextMenu?.(normalizeAbsoluteFsPath(row.path), event);
              }}
              onDragStart={(event) => {
                if (store.isFileDeleting(row.path)) {
                  event.preventDefault();
                  return;
                }
                setDraggingTreePath(normalizeAbsoluteFsPath(row.path));
                writeWorkspaceFileDragData(event.dataTransfer, row.path, { kind: row.isDirectory ? "directory" : "file" });
              }}
              onDragEnd={() => setDraggingTreePath("")}
            >
              {row.isDirectory ? (
                <ChevronRight className={["workspace-file-tree-row__chevron", row.isExpanded ? "rotate-90" : ""].filter(Boolean).join(" ")} aria-hidden="true" />
              ) : (
                <span className="workspace-file-tree-row__chevron workspace-file-tree-row__chevron--spacer" aria-hidden="true" />
              )}
              <WorkspaceTreeEntryIcon path={row.path} isDirectory={row.isDirectory} isExpanded={row.isExpanded} />
              <span className="workspace-file-tree-row__label">{row.label}</span>
              {treeRowMetaText(row) ? <span className="workspace-file-tree-row__meta">{treeRowMetaText(row)}</span> : null}
              {!treeRowMetaText(row) && row.gitStatus ? (
                <span className="workspace-file-tree-row__git" data-git-status={row.gitStatus.code} title={gitStatusTitle(row)} aria-hidden="true">
                  {row.gitStatus.code}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
