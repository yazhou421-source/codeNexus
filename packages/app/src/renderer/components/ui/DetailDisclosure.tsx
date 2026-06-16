import type { HTMLAttributes, ReactNode } from "react";
import Collapsible, { type CollapsibleRenderArgs } from "./Collapsible";

export type DetailDisclosureProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  open?: boolean;
  defaultOpen?: boolean;
  disabled?: boolean;
  motion?: "height" | "fade";
  keepMounted?: boolean;
  summaryClass?: string;
  summary?: ReactNode | ((args: CollapsibleRenderArgs) => ReactNode);
  onOpenChange?: (open: boolean) => void;
  "onUpdate:open"?: (open: boolean) => void;
  children?: ReactNode;
};

export default function DetailDisclosure({
  open,
  defaultOpen = false,
  disabled = false,
  motion = "fade",
  keepMounted = false,
  summaryClass = "",
  summary,
  onOpenChange,
  "onUpdate:open": onUpdateOpen,
  children,
  className,
  ...props
}: DetailDisclosureProps) {
  const handleOpenChange = (next: boolean) => {
    onOpenChange?.(Boolean(next));
    onUpdateOpen?.(Boolean(next));
  };

  return (
    <Collapsible
      {...props}
      className={["detail-disclosure", className].filter(Boolean).join(" ")}
      open={open}
      defaultOpen={defaultOpen}
      disabled={disabled}
      motion={motion}
      keepMounted={keepMounted}
      onOpenChange={handleOpenChange}
      trigger={(args) => (
        <div className={["min-w-0 cursor-pointer select-none", summaryClass].filter(Boolean).join(" ")} {...args.triggerProps}>
          {typeof summary === "function" ? summary(args) : summary}
        </div>
      )}
    >
      {children}
    </Collapsible>
  );
}
