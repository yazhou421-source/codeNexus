import ThreadHistoryPane from "./left-sidebar/ThreadHistoryPane";

type LeftSidebarProps = {
  className?: string;
};

export default function LeftSidebar({ className }: LeftSidebarProps) {
  return (
    <aside className={["sidebar sidebar-left", className].filter(Boolean).join(" ")}>
      <div className="lsb-shell lsb-shell--threads-only">
        <section className="lsb-pane-frame" data-pane="threads">
          <ThreadHistoryPane />
        </section>
      </div>
    </aside>
  );
}
