import type { HTMLAttributes } from "react";
import type { CommandSearchNode } from "../../../features/timeline/renderModel/buildTimelineNodes";
import CommandActivityRow from "./CommandActivityRow";

export default function CommandSearchActivityRow({ item, className, ...props }: HTMLAttributes<HTMLDivElement> & { item?: CommandSearchNode }) {
  return <CommandActivityRow {...props} className={className} kind="search" item={item} />;
}
