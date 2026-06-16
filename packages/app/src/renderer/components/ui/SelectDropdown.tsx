import type { ButtonHTMLAttributes, CSSProperties, KeyboardEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type OptionInput =
  | string
  | {
      value: string;
      label: string;
      disabled?: boolean;
    };

type NormalizedOption = {
  key: string;
  value: string;
  label: string;
  disabled: boolean;
};

export type SelectDropdownProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  modelValue?: string;
  value?: string;
  options?: readonly OptionInput[];
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  theme?: "auto" | "dark" | "light";
  minPopoverWidth?: number;
  popoverOwnerId?: string;
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
  "onUpdate:modelValue"?: (value: string) => void;
};

const POPOVER_GAP_PX = 6;
const POPOVER_MAX_HEIGHT_PX = 280;
const VIEWPORT_PADDING_PX = 8;

function normalizeOptions(options: readonly OptionInput[] | undefined): NormalizedOption[] {
  return (options ?? []).map((option) => {
    if (typeof option === "string") return { key: option, value: option, label: option, disabled: false };
    const value = String(option.value ?? "");
    const label = String(option.label ?? value);
    return { key: `${value}::${label}`, value, label, disabled: Boolean(option.disabled) };
  });
}

export default function SelectDropdown({
  modelValue,
  value,
  options,
  disabled = false,
  ariaLabel,
  placeholder = "",
  theme = "auto",
  minPopoverWidth = 140,
  popoverOwnerId = "",
  onChange,
  onValueChange,
  "onUpdate:modelValue": onUpdateModelValue,
  className,
  style,
  id,
  ...props
}: SelectDropdownProps) {
  const generatedId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const normalizedOptions = useMemo(() => normalizeOptions(options), [options]);
  const currentValue = String(modelValue ?? value ?? "");
  const listboxId = `${id || `ui-select-${generatedId.replace(/:/g, "")}`}__listbox`;
  const selectedLabel =
    normalizedOptions.find((option) => option.value === currentValue)?.label ||
    (!currentValue && placeholder ? placeholder : currentValue);
  const resolvedTheme =
    theme === "light" || theme === "dark"
      ? theme
      : typeof document !== "undefined" && document.documentElement.getAttribute("data-tone") === "light"
        ? "light"
        : "dark";

  const toOptionId = (index: number) => `${listboxId}__opt_${index}`;
  const clampIndex = (next: number) => Math.min(Math.max(0, next), Math.max(0, normalizedOptions.length - 1));
  const scrollActiveOptionIntoView = (index = activeIndex) => {
    document.getElementById(toOptionId(index))?.scrollIntoView({ block: "nearest" });
  };

  const updatePopoverPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(Math.max(0, Math.round(Number(minPopoverWidth) || 0)), Math.round(rect.width));
    const left = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(Math.round(rect.left), Math.round(window.innerWidth - width - VIEWPORT_PADDING_PX))
    );
    const optionHeight = 30;
    const rowGap = 4;
    const desiredHeight = Math.min(
      POPOVER_MAX_HEIGHT_PX,
      12 + normalizedOptions.length * optionHeight + Math.max(0, normalizedOptions.length - 1) * rowGap
    );
    const spaceBelow = Math.max(0, window.innerHeight - VIEWPORT_PADDING_PX - (rect.bottom + POPOVER_GAP_PX));
    const spaceAbove = Math.max(0, rect.top - POPOVER_GAP_PX - VIEWPORT_PADDING_PX);
    const openBelow = spaceBelow >= desiredHeight ? true : spaceAbove >= desiredHeight ? false : spaceBelow >= spaceAbove;
    const available = openBelow ? spaceBelow : spaceAbove;
    const maxHeight = Math.min(POPOVER_MAX_HEIGHT_PX, Math.max(60, Math.round(available)));
    const visibleHeight = Math.min(desiredHeight, maxHeight);
    const topRaw = openBelow ? rect.bottom + POPOVER_GAP_PX : rect.top - POPOVER_GAP_PX - visibleHeight;
    const top = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(Math.round(topRaw), Math.round(window.innerHeight - VIEWPORT_PADDING_PX - visibleHeight))
    );
    setPopoverStyle({ position: "fixed", left, top, width, maxHeight });
  };

  const openNow = () => {
    const selectedIndex = normalizedOptions.findIndex((option) => option.value === currentValue);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const pickValue = (nextValue: string) => {
    const option = normalizedOptions.find((item) => item.value === nextValue);
    if (!option || option.disabled) return;
    onUpdateModelValue?.(nextValue);
    onValueChange?.(nextValue);
    onChange?.(nextValue);
    close();
  };
  const moveActive = (delta: number) => {
    if (normalizedOptions.length === 0) return;
    let next = clampIndex(activeIndex + delta);
    for (let index = 0; index < normalizedOptions.length; index += 1) {
      if (!normalizedOptions[next]?.disabled) break;
      next = clampIndex(next + Math.sign(delta || 1));
    }
    setActiveIndex(next);
    requestAnimationFrame(() => scrollActiveOptionIntoView(next));
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        close();
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) openNow();
      else {
        const option = normalizedOptions[activeIndex];
        if (option && !option.disabled) pickValue(option.value);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) openNow();
      else moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openNow();
      else moveActive(-1);
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
      scrollActiveOptionIntoView(0);
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      const next = Math.max(0, normalizedOptions.length - 1);
      setActiveIndex(next);
      scrollActiveOptionIntoView(next);
      return;
    }
    if (event.key.length === 1 && open) {
      const idx = normalizedOptions.findIndex(
        (option) => !option.disabled && option.label.toLowerCase().startsWith(event.key.toLowerCase())
      );
      if (idx >= 0) {
        setActiveIndex(idx);
        scrollActiveOptionIntoView(idx);
      }
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    updatePopoverPosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      close();
    };
    const onLayout = () => updatePopoverPosition();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onLayout, true);
    window.addEventListener("scroll", onLayout, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onLayout, true);
      window.removeEventListener("scroll", onLayout, true);
    };
  }, [open, normalizedOptions.length, minPopoverWidth]);

  return (
    <>
      <button
        {...props}
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={["ui-select-trigger", className].filter(Boolean).join(" ")}
        style={style}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        aria-controls={listboxId}
        aria-activedescendant={open ? toOptionId(activeIndex) : undefined}
        aria-label={ariaLabel || props["aria-label"] || "Select option"}
        onClick={(event) => {
          props.onClick?.(event);
          if (!event.defaultPrevented && !disabled) {
            if (open) close();
            else openNow();
          }
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="ui-select-value mono">{selectedLabel}</span>
        <span className={["ui-select-chevron", open ? "open" : ""].filter(Boolean).join(" ")} aria-hidden="true">
          ▾
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className={[
                "ui-select-popover",
                "app-scrollbar",
                resolvedTheme === "light" ? "ui-select-popover--light" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={popoverStyle}
              data-composer-owner={popoverOwnerId || undefined}
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel || "Select option"}
            >
              {normalizedOptions.map((option, index) => (
                <button
                  id={toOptionId(index)}
                  key={option.key}
                  type="button"
                  className={[
                    "ui-select-option",
                    "mono",
                    option.value === currentValue ? "is-selected" : "",
                    index === activeIndex ? "is-active" : "",
                    option.disabled ? "is-disabled" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-value={option.value}
                  role="option"
                  aria-selected={option.value === currentValue ? "true" : "false"}
                  disabled={option.disabled}
                  style={{ "--i": index } as CSSProperties}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pickValue(option.value)}
                >
                  <span className="ui-select-option-label">{option.label}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
