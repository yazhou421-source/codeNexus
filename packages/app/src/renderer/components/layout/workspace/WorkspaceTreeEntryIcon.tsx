import { Icon } from "@iconify/react";
import type { HTMLAttributes } from "react";
import { resolveVscodeEntryIcon } from "./vscodeFileIcons";

export type WorkspaceTreeEntryIconProps = HTMLAttributes<HTMLSpanElement> & {
  path?: string;
  isDirectory?: boolean;
  isExpanded?: boolean;
};

export default function WorkspaceTreeEntryIcon({ path = "", isDirectory = false, isExpanded = false, className, ...props }: WorkspaceTreeEntryIconProps) {
  return (
    <span {...props} className={["workspace-file-tree-row__icon workspace-file-tree-row__icon--vscode", className].filter(Boolean).join(" ")} aria-hidden="true">
      <Icon icon={resolveVscodeEntryIcon(path, { isDirectory, isExpanded }) as any} />
    </span>
  );
}
