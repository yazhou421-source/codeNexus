import "./imagegen-workbench.css";

import { ChevronDown, Image as ImageIcon, Loader2, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { readImagegenLocalImageDataUrl, useImagegenWorkspacePathRef } from "../runtimeBridge";
import { useImageWorkbenchStore, type ImageWorkbenchHistoryItem } from "../store";

type ImageWorkspaceSidebarProps = {
  className?: string;
  children?: ReactNode;
};

type ImageWorkspaceGroup = {
  key: string;
  label: string;
  path: string | null;
  latestAt: number;
  items: ImageWorkbenchHistoryItem[];
};

const UNASSIGNED_WORKSPACE_KEY = "__unassigned__";

export default function ImageWorkspaceSidebar({ className, children }: ImageWorkspaceSidebarProps) {
  const { t, i18n } = useTranslation();
  const workbench = useImageWorkbenchStore();
  const currentWorkspacePath = useImagegenWorkspacePathRef();
  const [collapsedByKey, setCollapsedByKey] = useState<Record<string, boolean>>({});
  const [thumbByPath, setThumbByPath] = useState<Record<string, string>>({});
  const [thumbLoadingByPath, setThumbLoadingByPath] = useState<Record<string, boolean>>({});

  const basename = (pathValue: string) => {
    const normalized = String(pathValue ?? "").replace(/[\\/]+$/, "");
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || normalized || t("imageWorkspace.unknownWorkspace");
  };

  const groups = useMemo<ImageWorkspaceGroup[]>(() => {
    const byKey = new Map<string, ImageWorkspaceGroup>();
    for (const item of workbench.historyItems) {
      const workspacePath = String(item.workspacePath ?? "").trim();
      const key = workspacePath || UNASSIGNED_WORKSPACE_KEY;
      const existing = byKey.get(key);
      const createdAt = Number(item.createdAt) || 0;
      if (existing) {
        existing.latestAt = Math.max(existing.latestAt, createdAt);
        existing.items.push(item);
        continue;
      }
      byKey.set(key, {
        key,
        label: workspacePath ? basename(workspacePath) : t("imageWorkspace.unassigned"),
        path: workspacePath || null,
        latestAt: createdAt,
        items: [item],
      });
    }
    return [...byKey.values()]
      .map((group) => ({ ...group, items: [...group.items].sort((a, b) => Number(b.createdAt) - Number(a.createdAt)) }))
      .sort((a, b) => {
        const current = currentWorkspacePath.value;
        if (current && a.path === current && b.path !== current) return -1;
        if (current && b.path === current && a.path !== current) return 1;
        if (a.key === UNASSIGNED_WORKSPACE_KEY && b.key !== UNASSIGNED_WORKSPACE_KEY) return 1;
        if (b.key === UNASSIGNED_WORKSPACE_KEY && a.key !== UNASSIGNED_WORKSPACE_KEY) return -1;
        return b.latestAt - a.latestAt;
      });
  }, [workbench.historyItems, currentWorkspacePath.value, t]);

  const statusKind = (item: ImageWorkbenchHistoryItem): "ready" | "pending" | "failed" | "canceled" => item.workbenchStatus ?? "ready";
  const isPending = (item: ImageWorkbenchHistoryItem) => statusKind(item) === "pending";
  const isProblem = (item: ImageWorkbenchHistoryItem) => statusKind(item) === "failed" || statusKind(item) === "canceled";
  const isSelectable = (item: ImageWorkbenchHistoryItem) => statusKind(item) === "ready" && item.images.length > 0;
  const statusLabel = (item: ImageWorkbenchHistoryItem) => {
    const status = statusKind(item);
    if (status === "pending") return item.errorText || t("imageWorkbench.generating");
    if (status === "failed") return t("imageWorkbench.generationFailed");
    if (status === "canceled") return t("imageWorkbench.canceled");
    return t("imageWorkbench.succeeded");
  };
  const formatTime = (value: number) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t("imageWorkbench.unknownTime");
    return date.toLocaleString(i18n.language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
  const firstImagePath = (item: ImageWorkbenchHistoryItem) => String(item.images[0]?.path ?? "").trim();
  const thumbSrc = (item: ImageWorkbenchHistoryItem) => {
    const path = firstImagePath(item);
    return path ? (thumbByPath[path] ?? "") : "";
  };
  const toggleGroup = (key: string) => setCollapsedByKey((current) => ({ ...current, [key]: !current[key] }));
  const selectItem = (item: ImageWorkbenchHistoryItem) => {
    if (!isSelectable(item)) return;
    workbench.selectHistoryItem(item.id);
  };
  const onItemKeyDown = (event: KeyboardEvent<HTMLElement>, item: ImageWorkbenchHistoryItem) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectItem(item);
  };

  const ensureThumb = async (pathValue: string) => {
    const path = String(pathValue ?? "").trim();
    if (!path || thumbByPath[path] || thumbLoadingByPath[path]) return;
    setThumbLoadingByPath((current) => ({ ...current, [path]: true }));
    try {
      const dataUrl = await readImagegenLocalImageDataUrl(path);
      if (dataUrl) setThumbByPath((current) => ({ ...current, [path]: dataUrl }));
    } catch {
      setThumbByPath((current) => ({ ...current, [path]: "" }));
    } finally {
      setThumbLoadingByPath((current) => ({ ...current, [path]: false }));
    }
  };

  useEffect(() => {
    void workbench.loadHistory();
  }, []);

  useEffect(() => {
    const paths = workbench.historyItems.map((item) => firstImagePath(item)).filter(Boolean);
    for (const path of paths) void ensureThumb(path);
  }, [workbench.historyItems]);

  return (
    <aside className={["sidebar", "sidebar-left", "image-workspace-sidebar", className].filter(Boolean).join(" ")} aria-label={t("imageWorkspace.aria")}>
      <div className="lsb-shell image-workspace-shell">
        <section className="lsb-pane-frame">
          <div className="lsb-pane-content image-workspace-pane">
            <header className="lsb-pane-head image-workspace-head">
              <div className="lsb-pane-head-row">
                <div className="image-workspace-title-block">
                  <span className="image-workspace-title-icon" aria-hidden="true">
                    <ImageIcon />
                  </span>
                  <div className="image-workspace-title-copy">
                    <h2 className="lsb-pane-title">{t("imageWorkspace.title")}</h2>
                    <div className="image-workspace-summary mono">{t("imageWorkspace.recordCount", { count: workbench.historyItems.length })}</div>
                  </div>
                </div>
                <button className="lsb-icon-btn image-workspace-refresh" type="button" aria-label={t("common.refresh")} disabled={workbench.historyLoading} onClick={() => void workbench.loadHistory()}>
                  <RefreshCw className={workbench.historyLoading ? "is-spinning" : ""} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="lsb-scroll image-workspace-scroll app-scrollbar">
              {workbench.historyLoading && workbench.historyItems.length === 0 ? (
                <div className="image-workspace-empty">
                  <Loader2 className="is-spinning" aria-hidden="true" />
                  <span>{t("imageWorkbench.loadingHistory")}</span>
                </div>
              ) : groups.length === 0 ? (
                <div className="image-workspace-empty">
                  <ImageIcon aria-hidden="true" />
                  <span>{t("imageWorkbench.emptyHistory")}</span>
                </div>
              ) : (
                groups.map((group) => (
                  <section key={group.key} className="image-workspace-group">
                    <button className="image-workspace-group__head" type="button" onClick={() => toggleGroup(group.key)}>
                      <ChevronDown className={`image-workspace-group__chevron${collapsedByKey[group.key] ? " is-collapsed" : ""}`} aria-hidden="true" />
                      <span className="image-workspace-group__title" title={group.path || group.label}>
                        {group.label}
                      </span>
                      <span className="image-workspace-group__count mono">{group.items.length}</span>
                    </button>

                    {!collapsedByKey[group.key] ? (
                      <div className="image-workspace-list">
                        {group.items.map((item) => (
                          <article
                            key={item.id}
                            className={[
                              "image-workspace-item",
                              `is-${statusKind(item)}`,
                              item.id === workbench.selectedHistoryId ? "is-selected" : "",
                              !isSelectable(item) ? "is-disabled" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            role={isSelectable(item) ? "button" : undefined}
                            tabIndex={isSelectable(item) ? 0 : -1}
                            onClick={() => selectItem(item)}
                            onKeyDown={(event) => onItemKeyDown(event, item)}
                          >
                            <div className="image-workspace-item__thumb">
                              {thumbSrc(item) ? (
                                <img src={thumbSrc(item)} alt={item.prompt} loading="lazy" />
                              ) : isPending(item) ? (
                                <Loader2 className="is-spinning" aria-hidden="true" />
                              ) : item.taskId && isProblem(item) ? (
                                <button className="image-workspace-item__thumb-retry" type="button" aria-label={t("imageWorkbench.retryTask")} onClick={(event) => { event.stopPropagation(); void workbench.retryTask(item.taskId!); }}>
                                  <RotateCcw aria-hidden="true" />
                                </button>
                              ) : isProblem(item) ? (
                                <RotateCcw aria-hidden="true" />
                              ) : (
                                <ImageIcon aria-hidden="true" />
                              )}
                            </div>

                            <div className="image-workspace-item__body">
                              <div className="image-workspace-item__meta">
                                <span className="image-workspace-item__time mono">{formatTime(item.createdAt)}</span>
                                <span className="image-workspace-item__status">{statusLabel(item)}</span>
                              </div>
                              <div className="image-workspace-item__prompt">{item.prompt}</div>
                            </div>

                            <div className="image-workspace-item__actions">
                              {item.taskId && isPending(item) ? (
                                <button className="image-workspace-action" type="button" aria-label={t("imageWorkbench.cancelTask")} onClick={(event) => { event.stopPropagation(); void workbench.cancelTask(item.taskId!); }}>
                                  <X aria-hidden="true" />
                                </button>
                              ) : null}
                              <button className="image-workspace-action is-danger" type="button" aria-label={t("imageWorkbench.delete")} onClick={(event) => { event.stopPropagation(); void workbench.deleteHistoryItem(item.id); }}>
                                <Trash2 aria-hidden="true" />
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ))
              )}
              {children}
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}
