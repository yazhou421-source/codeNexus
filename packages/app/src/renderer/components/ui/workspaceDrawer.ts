import type { ObjectDirective } from "vue";

const cleanupByElement = new WeakMap<HTMLElement, () => void>();
/** Preserve the existing sidebar instance while giving its overlay mode keyboard containment. */
export const workspaceDrawer: ObjectDirective<HTMLElement, (() => void) | null> = {
  mounted: update,
  updated: update,
  unmounted(element) {
    cleanupByElement.get(element)?.();
  },
};
function update(element: HTMLElement, binding: { value: (() => void) | null }) {
  if (!binding.value) {
    cleanupByElement.get(element)?.();
    return;
  }
  if (cleanupByElement.has(element)) return;
  const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const previous = ["role", "aria-modal", "tabindex"].map((name) => [name, element.getAttribute(name)] as const);
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("tabindex", "-1");
  const controls = () =>
    [
      ...element.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"], a[href]'
      ),
    ].filter((node) => node.getClientRects().length > 0);
  const keydown = (event: KeyboardEvent) => {
    if (document.querySelector("dialog[open]")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      binding.value?.();
    }
    if (event.key !== "Tab") return;
    const items = controls();
    const first = items[0] || element;
    const last = items.at(-1) || element;
    if (
      !element.contains(document.activeElement) ||
      (event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };
  document.addEventListener("keydown", keydown, true);
  queueMicrotask(() => {
    if (element.isConnected) (controls()[0] || element).focus();
  });
  cleanupByElement.set(element, () => {
    document.removeEventListener("keydown", keydown, true);
    for (const [name, value] of previous) {
      if (value !== null) element.setAttribute(name, value);
      else element.removeAttribute(name);
    }
    cleanupByElement.delete(element);
    if (restore?.isConnected) restore.focus();
  });
}
