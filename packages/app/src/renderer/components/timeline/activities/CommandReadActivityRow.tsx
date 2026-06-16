import type { HTMLAttributes } from "react";
import type { CommandReadNode } from "../../../features/timeline/renderModel/buildTimelineNodes";
import CommandActivityRow from "./CommandActivityRow";

export default function CommandReadActivityRow({ item, className, ...props }: HTMLAttributes<HTMLDivElement> & { item?: CommandReadNode }) {
  return <CommandActivityRow {...props} className={className} kind="read" item={item} />;
}
