import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useId, useMemo, useState } from "react";

export type CollapsibleRenderArgs = {
  open: boolean;
  disabled: boolean;
  toggle: () => void;
  triggerProps: {
    role: "button";
    tabIndex: number;
    "aria-expanded": "true" | "false";
    "aria-controls": string;
    onClick: (event: MouseEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
};

export type CollapsibleProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  open?: boolean;
  defaultOpen?: boolean;
  disabled?: boolean;
  contentId?: string;
  motion?: "height" | "fade";
  keepMounted?: boolean;
  onOpenChange?: (open: boolean) => void;
  "onUpdate:open"?: (open: boolean) => void;
  trigger?: ReactNode | ((args: CollapsibleRenderArgs) => ReactNode);
  children?: ReactNode | ((args: CollapsibleRenderArgs) => ReactNode);
};

export default function Collapsible({
  open,
  defaultOpen = false,
  disabled = false,
  contentId,
  motion = "height",
  keepMounted = false,
  onOpenChange,
  "onUpdate:open": onUpdateOpen,
  trigger,
  children,
  className,
  ...props
}: CollapsibleProps) {
  const generatedId = useId();
  const [internalOpen, setInternalOpen] = useState(Boolean(defaultOpen));
  const isControlled = typeof open === "boolean";
  const isOpen = isControlled ? Boolean(open) : internalOpen;
  const resolvedContentId = contentId || `ui-collapsible-${generatedId.replace(/:/g, "")}`;

  const setOpen = (next: boolean) => {
    if (disabled) return;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
    onUpdateOpen?.(next);
  };
  const toggle = () => setOpen(!isOpen);
  const onTriggerClick = (event: MouseEvent<HTMLElement>) => {
    if (disabled) return;
    event.preventDefault();
    toggle();
  };
  const onTriggerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };

  const renderArgs = useMemo<CollapsibleRenderArgs>(
    () => ({
      open: isOpen,
      disabled,
      toggle,
      triggerProps: {
        role: "button",
        tabIndex: disabled ? -1 : 0,
        "aria-expanded": isOpen ? "true" : "false",
        "aria-controls": resolvedContentId,
        onClick: onTriggerClick,
        onKeyDown: onTriggerKeyDown,
      },
    }),
    [disabled, isOpen, resolvedContentId]
  );
  const shouldRenderFade = motion === "fade" && (isOpen || keepMounted);
  const content = typeof children === "function" ? children(renderArgs) : children;

  return (
    <div
      {...props}
      className={["ui-collapsible", isOpen ? "is-open" : "", disabled ? "is-disabled" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {typeof trigger === "function" ? trigger(renderArgs) : trigger}
      {motion === "fade" ? (
        shouldRenderFade ? (
          <div id={resolvedContentId} className="ui-collapsible-fade-content" aria-hidden={isOpen ? "false" : "true"} hidden={!isOpen}>
            {content}
          </div>
        ) : null
      ) : (
        <div
          id={resolvedContentId}
          className={["ui-collapsible-content", isOpen ? "is-open" : ""].filter(Boolean).join(" ")}
          aria-hidden={isOpen ? "false" : "true"}
        >
          <div className="ui-collapsible-inner">{content}</div>
        </div>
      )}
    </div>
  );
}
