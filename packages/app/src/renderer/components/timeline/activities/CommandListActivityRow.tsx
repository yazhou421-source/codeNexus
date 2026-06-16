import type { HTMLAttributes } from "react";
import type { CommandListNode } from "../../../features/timeline/renderModel/buildTimelineNodes";
import CommandActivityRow from "./CommandActivityRow";

export default function CommandListActivityRow({ item, className, ...props }: HTMLAttributes<HTMLDivElement> & { item?: CommandListNode }) {
  return <CommandActivityRow {...props} className={className} kind="list" item={item} />;
}
