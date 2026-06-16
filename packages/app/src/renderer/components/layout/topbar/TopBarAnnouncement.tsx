type TopBarAnnouncementProps = {
  message?: string;
  className?: string;
};

export default function TopBarAnnouncement({ message, className }: TopBarAnnouncementProps) {
  if (!message) return null;
  return <div className={["topbar-pill", className].filter(Boolean).join(" ")}><span className="topbar-pill-value">{message}</span></div>;
}
