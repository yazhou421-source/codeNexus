type PromptNumberModalOptions = {
  title: string;
  message: string;
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  defaultValue: number;
  min: number;
  max: number;
};

type PromptGoalModalOptions = {
  title: string;
  message: string;
  objectiveLabel: string;
  budgetLabel: string;
  budgetHint?: string;
  confirmText?: string;
  cancelText?: string;
  defaultObjective?: string;
  defaultTokenBudget?: number | null;
  shutdownOnCompleteLabel?: string;
  shutdownOnCompleteHint?: string;
  defaultShutdownOnComplete?: boolean;
};

export type PromptGoalModalResult = {
  objective: string;
  tokenBudget: number | null;
  shutdownOnComplete: boolean;
};

type ConfirmModalOptions = {
  title: string;
  message: string;
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type ActionModalButton = {
  key: string;
  label: string;
  kind?: "default" | "danger";
  autoFocus?: boolean;
};

type ActionModalOptions = {
  title: string;
  message: string;
  detail?: string;
  buttons: ActionModalButton[];
  cancelKey?: string;
};

let activeModalCleanup: (() => void) | null = null;

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const selectors = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ];
  const list = Array.from(root.querySelectorAll<HTMLElement>(selectors.join(",")));
  return list.filter((el) => {
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

export async function promptNumberModal(options: PromptNumberModalOptions): Promise<number | null> {
  if (activeModalCleanup) {
    throw new Error("promptNumberModal: another modal is already open");
  }

  const title = String(options?.title ?? "").trim() || "输入";
  const message = String(options?.message ?? "").trim() || "";
  const detail = typeof options?.detail === "string" ? options.detail : undefined;
  const confirmText = String(options?.confirmText ?? "").trim() || "确认";
  const cancelText = String(options?.cancelText ?? "").trim() || "取消";
  const danger = Boolean(options?.danger);

  const min = Number.isFinite(options?.min) ? Math.round(options.min) : 1;
  const max = Number.isFinite(options?.max) ? Math.round(options.max) : min;
  const defaultValueRaw = Number.isFinite(options?.defaultValue) ? Math.round(options.defaultValue) : min;
  const defaultValue = Math.max(min, Math.min(max, defaultValueRaw));

  const previousFocus = document.activeElement as HTMLElement | null;

  const overlay = document.createElement("div");
  overlay.className = "codex-modal-overlay";
  overlay.setAttribute("role", "presentation");

  const modal = document.createElement("div");
  modal.className = `codex-modal${danger ? " danger" : ""}`;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", title);
  modal.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "codex-modal-header";

  const h = document.createElement("div");
  h.className = "codex-modal-title";
  h.textContent = title;
  header.appendChild(h);

  const body = document.createElement("div");
  body.className = "codex-modal-body";

  const msg = document.createElement("div");
  msg.className = "codex-modal-message";
  msg.textContent = message;
  body.appendChild(msg);

  if (detail && detail.trim()) {
    const d = document.createElement("pre");
    d.className = "codex-modal-detail app-scrollbar mono";
    d.textContent = detail;
    body.appendChild(d);
  }

  const inputWrap = document.createElement("div");
  inputWrap.className = "codex-modal-input-wrap";

  const num = document.createElement("input");
  num.className = "codex-modal-input mono";
  num.type = "number";
  num.min = String(min);
  num.max = String(max);
  num.step = "1";
  num.value = String(defaultValue);
  num.setAttribute("aria-label", "number-input");
  inputWrap.appendChild(num);
  body.appendChild(inputWrap);

  const actions = document.createElement("div");
  actions.className = "codex-modal-actions";

  const btnCancel = document.createElement("button");
  btnCancel.type = "button";
  btnCancel.className = "codex-modal-btn";
  btnCancel.textContent = cancelText;

  const btnConfirm = document.createElement("button");
  btnConfirm.type = "button";
  btnConfirm.className = `codex-modal-btn${danger ? " danger" : ""}`;
  btnConfirm.textContent = confirmText;

  actions.appendChild(btnCancel);
  actions.appendChild(btnConfirm);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  const root = document.documentElement;
  const previousOverflow = root.style.overflow;

  return await new Promise<number | null>(async (resolve) => {
    let resolved = false;

    function resolveOnce(value: number | null) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    }

    const readValue = () => {
      const parsed = Number(num.value);
      if (!Number.isFinite(parsed)) return null;
      const n = Math.round(parsed);
      if (n < min || n > max) return null;
      return n;
    };

    const onCancelClick = (evt: Event) => {
      evt.preventDefault();
      evt.stopPropagation();
      resolveOnce(null);
    };

    const onConfirmClick = (evt: Event) => {
      evt.preventDefault();
      evt.stopPropagation();
      resolveOnce(readValue());
    };

    const onOverlayClick = (evt: MouseEvent) => {
      if (evt.target !== overlay) return;
      resolveOnce(null);
    };

    const onKeydown = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        resolveOnce(null);
        return;
      }

      if (evt.key === "Tab") {
        const focusables = getFocusableElements(modal);
        if (focusables.length === 0) return;
        const current = document.activeElement as HTMLElement | null;
        const idx = current ? focusables.indexOf(current) : -1;
        const next = evt.shiftKey
          ? idx <= 0
            ? focusables.length - 1
            : idx - 1
          : idx >= focusables.length - 1
            ? 0
            : idx + 1;
        evt.preventDefault();
        focusables[next]?.focus();
        return;
      }

      if (evt.key === "Enter") {
        // 当焦点在输入框或“确认”按钮上时，回车触发确认。
        if (document.activeElement === num || document.activeElement === btnConfirm) {
          evt.preventDefault();
          resolveOnce(readValue());
        }
      }
    };

    function cleanup() {
      try {
        window.removeEventListener("keydown", onKeydown, true);
      } catch {}
      try {
        overlay.removeEventListener("click", onOverlayClick, true);
      } catch {}
      try {
        btnCancel.removeEventListener("click", onCancelClick, true);
      } catch {}
      try {
        btnConfirm.removeEventListener("click", onConfirmClick, true);
      } catch {}
      try {
        if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      } catch {}
      try {
        root.style.overflow = previousOverflow;
      } catch {}
      activeModalCleanup = null;
      try {
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
      } catch {}
    }

    activeModalCleanup = cleanup;

    overlay.addEventListener("click", onOverlayClick, true);
    btnCancel.addEventListener("click", onCancelClick, true);
    btnConfirm.addEventListener("click", onConfirmClick, true);
    window.addEventListener("keydown", onKeydown, true);

    document.body.appendChild(overlay);
    root.style.overflow = "hidden";

    await new Promise<void>((r) => setTimeout(r, 0));
    try {
      num.focus();
      num.select();
    } catch {
      try {
        modal.focus();
      } catch {}
    }
  });
}

export async function promptGoalModal(options: PromptGoalModalOptions): Promise<PromptGoalModalResult | null> {
  if (activeModalCleanup) {
    throw new Error("promptGoalModal: another modal is already open");
  }

  const title = String(options?.title ?? "").trim() || "输入";
  const message = String(options?.message ?? "").trim() || "";
  const objectiveLabel = String(options?.objectiveLabel ?? "").trim() || "输入";
  const budgetLabel = String(options?.budgetLabel ?? "").trim() || "Token budget";
  const budgetHint = String(options?.budgetHint ?? "").trim();
  const confirmText = String(options?.confirmText ?? "").trim() || "确认";
  const cancelText = String(options?.cancelText ?? "").trim() || "取消";
  const shutdownOnCompleteLabel = String(options?.shutdownOnCompleteLabel ?? "").trim();
  const shutdownOnCompleteHint = String(options?.shutdownOnCompleteHint ?? "").trim();
  const previousFocus = document.activeElement as HTMLElement | null;

  const overlay = document.createElement("div");
  overlay.className = "codex-modal-overlay";
  overlay.setAttribute("role", "presentation");

  const modal = document.createElement("div");
  modal.className = "codex-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", title);
  modal.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "codex-modal-header";
  const h = document.createElement("div");
  h.className = "codex-modal-title";
  h.textContent = title;
  header.appendChild(h);

  const body = document.createElement("div");
  body.className = "codex-modal-body";
  if (message) {
    const msg = document.createElement("div");
    msg.className = "codex-modal-message";
    msg.textContent = message;
    body.appendChild(msg);
  }

  const objectiveWrap = document.createElement("label");
  objectiveWrap.className = "codex-modal-field";
  const objectiveCaption = document.createElement("span");
  objectiveCaption.className = "codex-modal-field-label";
  objectiveCaption.textContent = objectiveLabel;
  const objectiveInput = document.createElement("textarea");
  objectiveInput.className = "codex-modal-input codex-modal-textarea";
  objectiveInput.rows = 4;
  objectiveInput.value = String(options?.defaultObjective ?? "");
  objectiveWrap.appendChild(objectiveCaption);
  objectiveWrap.appendChild(objectiveInput);
  body.appendChild(objectiveWrap);

  const budgetWrap = document.createElement("label");
  budgetWrap.className = "codex-modal-field";
  const budgetCaption = document.createElement("span");
  budgetCaption.className = "codex-modal-field-label";
  budgetCaption.textContent = budgetLabel;
  const budgetInput = document.createElement("input");
  budgetInput.className = "codex-modal-input mono";
  budgetInput.type = "number";
  budgetInput.min = "1";
  budgetInput.step = "1";
  const defaultBudget = Number(options?.defaultTokenBudget);
  budgetInput.value = Number.isFinite(defaultBudget) && defaultBudget > 0 ? String(Math.round(defaultBudget)) : "";
  budgetWrap.appendChild(budgetCaption);
  budgetWrap.appendChild(budgetInput);
  if (budgetHint) {
    const hint = document.createElement("span");
    hint.className = "codex-modal-field-hint";
    hint.textContent = budgetHint;
    budgetWrap.appendChild(hint);
  }
  body.appendChild(budgetWrap);

  let shutdownInput: HTMLInputElement | null = null;
  if (shutdownOnCompleteLabel) {
    const shutdownWrap = document.createElement("label");
    shutdownWrap.className = "codex-modal-field";
    shutdownWrap.style.cursor = "pointer";
    const row = document.createElement("span");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "10px";
    shutdownInput = document.createElement("input");
    shutdownInput.type = "checkbox";
    shutdownInput.checked = Boolean(options?.defaultShutdownOnComplete);
    const labelText = document.createElement("span");
    labelText.className = "codex-modal-field-label";
    labelText.textContent = shutdownOnCompleteLabel;
    row.appendChild(shutdownInput);
    row.appendChild(labelText);
    shutdownWrap.appendChild(row);
    if (shutdownOnCompleteHint) {
      const hint = document.createElement("span");
      hint.className = "codex-modal-field-hint";
      hint.textContent = shutdownOnCompleteHint;
      shutdownWrap.appendChild(hint);
    }
    body.appendChild(shutdownWrap);
  }

  const actions = document.createElement("div");
  actions.className = "codex-modal-actions";

  const btnCancel = document.createElement("button");
  btnCancel.type = "button";
  btnCancel.className = "codex-modal-btn";
  btnCancel.textContent = cancelText;

  const btnConfirm = document.createElement("button");
  btnConfirm.type = "button";
  btnConfirm.className = "codex-modal-btn";
  btnConfirm.textContent = confirmText;

  actions.appendChild(btnCancel);
  actions.appendChild(btnConfirm);
  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  const root = document.documentElement;
  const previousOverflow = root.style.overflow;

  return await new Promise<PromptGoalModalResult | null>(async (resolve) => {
    let resolved = false;

    const readValue = (): PromptGoalModalResult | null => {
      const objective = String(objectiveInput.value ?? "").trim();
      if (!objective) return null;
      const rawBudget = String(budgetInput.value ?? "").trim();
      if (!rawBudget) return { objective, tokenBudget: null, shutdownOnComplete: Boolean(shutdownInput?.checked) };
      const parsed = Number(rawBudget);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return { objective, tokenBudget: Math.round(parsed), shutdownOnComplete: Boolean(shutdownInput?.checked) };
    };

    const syncValidity = () => {
      btnConfirm.disabled = !readValue();
    };

    function resolveOnce(value: PromptGoalModalResult | null) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    }

    const onCancelClick = (evt: Event) => {
      evt.preventDefault();
      evt.stopPropagation();
      resolveOnce(null);
    };

    const onConfirmClick = (evt: Event) => {
      evt.preventDefault();
      evt.stopPropagation();
      const value = readValue();
      if (value) resolveOnce(value);
    };

    const onOverlayClick = (evt: MouseEvent) => {
      if (evt.target !== overlay) return;
      resolveOnce(null);
    };

    const onKeydown = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        resolveOnce(null);
        return;
      }

      if (evt.key === "Tab") {
        const focusables = getFocusableElements(modal);
        if (focusables.length === 0) return;
        const current = document.activeElement as HTMLElement | null;
        const idx = current ? focusables.indexOf(current) : -1;
        const next = evt.shiftKey
          ? idx <= 0
            ? focusables.length - 1
            : idx - 1
          : idx >= focusables.length - 1
            ? 0
            : idx + 1;
        evt.preventDefault();
        focusables[next]?.focus();
        return;
      }

      if ((evt.ctrlKey || evt.metaKey) && evt.key === "Enter") {
        const value = readValue();
        if (!value) return;
        evt.preventDefault();
        resolveOnce(value);
      }
    };

    function cleanup() {
      try {
        window.removeEventListener("keydown", onKeydown, true);
      } catch {}
      try {
        overlay.removeEventListener("click", onOverlayClick, true);
      } catch {}
      try {
        objectiveInput.removeEventListener("input", syncValidity);
        budgetInput.removeEventListener("input", syncValidity);
        btnCancel.removeEventListener("click", onCancelClick, true);
        btnConfirm.removeEventListener("click", onConfirmClick, true);
      } catch {}
      try {
        if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      } catch {}
      try {
        root.style.overflow = previousOverflow;
      } catch {}
      activeModalCleanup = null;
      try {
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
      } catch {}
    }

    activeModalCleanup = cleanup;
    overlay.addEventListener("click", onOverlayClick, true);
    objectiveInput.addEventListener("input", syncValidity);
    budgetInput.addEventListener("input", syncValidity);
    btnCancel.addEventListener("click", onCancelClick, true);
    btnConfirm.addEventListener("click", onConfirmClick, true);
    window.addEventListener("keydown", onKeydown, true);

    syncValidity();
    document.body.appendChild(overlay);
    root.style.overflow = "hidden";

    await new Promise<void>((r) => setTimeout(r, 0));
    try {
      objectiveInput.focus();
      objectiveInput.select();
    } catch {
      try {
        modal.focus();
      } catch {}
    }
  });
}

export async function confirmModal(options: ConfirmModalOptions): Promise<boolean> {
  if (activeModalCleanup) {
    throw new Error("confirmModal: another modal is already open");
  }

  const title = String(options?.title ?? "").trim() || "确认";
  const message = String(options?.message ?? "").trim() || "";
  const detail = typeof options?.detail === "string" ? options.detail : undefined;
  const confirmText = String(options?.confirmText ?? "").trim() || "确认";
  const cancelText = String(options?.cancelText ?? "").trim() || "取消";
  const danger = Boolean(options?.danger);

  const previousFocus = document.activeElement as HTMLElement | null;

  const overlay = document.createElement("div");
  overlay.className = "codex-modal-overlay";
  overlay.setAttribute("role", "presentation");

  const modal = document.createElement("div");
  modal.className = `codex-modal${danger ? " danger" : ""}`;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", title);
  modal.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "codex-modal-header";

  const h = document.createElement("div");
  h.className = "codex-modal-title";
  h.textContent = title;
  header.appendChild(h);

  const body = document.createElement("div");
  body.className = "codex-modal-body";

  const msg = document.createElement("div");
  msg.className = "codex-modal-message";
  msg.textContent = message;
  body.appendChild(msg);

  if (detail && detail.trim()) {
    const d = document.createElement("pre");
    d.className = "codex-modal-detail app-scrollbar mono";
    d.textContent = detail;
    body.appendChild(d);
  }

  const actions = document.createElement("div");
  actions.className = "codex-modal-actions";

  const btnCancel = document.createElement("button");
  btnCancel.type = "button";
  btnCancel.className = "codex-modal-btn";
  btnCancel.textContent = cancelText;

  const btnConfirm = document.createElement("button");
  btnConfirm.type = "button";
  btnConfirm.className = `codex-modal-btn${danger ? " danger" : ""}`;
  btnConfirm.textContent = confirmText;

  actions.appendChild(btnCancel);
  actions.appendChild(btnConfirm);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  const root = document.documentElement;
  const previousOverflow = root.style.overflow;

  return await new Promise<boolean>(async (resolve) => {
    let resolved = false;

    function resolveOnce(value: boolean) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    }

    const onCancelClick = (evt: Event) => {
      evt.preventDefault();
      evt.stopPropagation();
      resolveOnce(false);
    };

    const onConfirmClick = (evt: Event) => {
      evt.preventDefault();
      evt.stopPropagation();
      resolveOnce(true);
    };

    const onOverlayClick = (evt: MouseEvent) => {
      if (evt.target !== overlay) return;
      resolveOnce(false);
    };

    const onKeydown = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        resolveOnce(false);
        return;
      }

      if (evt.key === "Tab") {
        const focusables = getFocusableElements(modal);
        if (focusables.length === 0) return;
        const current = document.activeElement as HTMLElement | null;
        const idx = current ? focusables.indexOf(current) : -1;
        const next = evt.shiftKey
          ? idx <= 0
            ? focusables.length - 1
            : idx - 1
          : idx >= focusables.length - 1
            ? 0
            : idx + 1;
        evt.preventDefault();
        focusables[next]?.focus();
        return;
      }

      if (evt.key === "Enter") {
        if (document.activeElement === btnConfirm) {
          evt.preventDefault();
          resolveOnce(true);
        }
      }
    };

    function cleanup() {
      try {
        window.removeEventListener("keydown", onKeydown, true);
      } catch {}
      try {
        overlay.removeEventListener("click", onOverlayClick, true);
      } catch {}
      try {
        btnCancel.removeEventListener("click", onCancelClick, true);
      } catch {}
      try {
        btnConfirm.removeEventListener("click", onConfirmClick, true);
      } catch {}
      try {
        if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      } catch {}
      try {
        root.style.overflow = previousOverflow;
      } catch {}
      activeModalCleanup = null;
      try {
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
      } catch {}
    }

    activeModalCleanup = cleanup;

    overlay.addEventListener("click", onOverlayClick, true);
    btnCancel.addEventListener("click", onCancelClick, true);
    btnConfirm.addEventListener("click", onConfirmClick, true);
    window.addEventListener("keydown", onKeydown, true);

    document.body.appendChild(overlay);
    root.style.overflow = "hidden";

    await new Promise<void>((r) => setTimeout(r, 0));
    try {
      btnConfirm.focus();
    } catch {
      try {
        modal.focus();
      } catch {}
    }
  });
}

export async function actionModal(options: ActionModalOptions): Promise<string> {
  if (activeModalCleanup) {
    throw new Error("actionModal: another modal is already open");
  }

  const title = String(options?.title ?? "").trim() || "确认";
  const message = String(options?.message ?? "").trim() || "";
  const detail = typeof options?.detail === "string" ? options.detail : undefined;
  const buttons = Array.isArray(options?.buttons)
    ? options.buttons
        .map((button) => ({
          key: String(button?.key ?? "").trim(),
          label: String(button?.label ?? "").trim(),
          kind: button?.kind === "danger" ? "danger" : "default",
          autoFocus: Boolean(button?.autoFocus),
        }))
        .filter((button) => button.key && button.label)
    : [];

  if (buttons.length < 2) {
    throw new Error("actionModal: expected at least two buttons");
  }

  const cancelKey = buttons.some((button) => button.key === options?.cancelKey)
    ? String(options?.cancelKey)
    : buttons[buttons.length - 1]!.key;

  const previousFocus = document.activeElement as HTMLElement | null;

  const overlay = document.createElement("div");
  overlay.className = "codex-modal-overlay";
  overlay.setAttribute("role", "presentation");

  const modal = document.createElement("div");
  modal.className = "codex-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", title);
  modal.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "codex-modal-header";

  const h = document.createElement("div");
  h.className = "codex-modal-title";
  h.textContent = title;
  header.appendChild(h);

  const body = document.createElement("div");
  body.className = "codex-modal-body";

  const msg = document.createElement("div");
  msg.className = "codex-modal-message";
  msg.textContent = message;
  body.appendChild(msg);

  if (detail && detail.trim()) {
    const d = document.createElement("pre");
    d.className = "codex-modal-detail app-scrollbar mono";
    d.textContent = detail;
    body.appendChild(d);
  }

  const actions = document.createElement("div");
  actions.className = "codex-modal-actions";

  const buttonEntries = buttons.map((button) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `codex-modal-btn${button.kind === "danger" ? " danger" : ""}`;
    element.textContent = button.label;
    element.dataset.actionKey = button.key;
    actions.appendChild(element);
    return { button, element };
  });

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  const root = document.documentElement;
  const previousOverflow = root.style.overflow;

  return await new Promise<string>(async (resolve) => {
    let resolved = false;

    function resolveOnce(value: string) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    }

    const onOverlayClick = (evt: MouseEvent) => {
      if (evt.target !== overlay) return;
      resolveOnce(cancelKey);
    };

    const onKeydown = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        resolveOnce(cancelKey);
        return;
      }

      if (evt.key === "Tab") {
        const focusables = getFocusableElements(modal);
        if (focusables.length === 0) return;
        const current = document.activeElement as HTMLElement | null;
        const idx = current ? focusables.indexOf(current) : -1;
        const next = evt.shiftKey
          ? idx <= 0
            ? focusables.length - 1
            : idx - 1
          : idx >= focusables.length - 1
            ? 0
            : idx + 1;
        evt.preventDefault();
        focusables[next]?.focus();
        return;
      }

      if (evt.key === "Enter") {
        const active = document.activeElement as HTMLButtonElement | null;
        const key = String(active?.dataset?.actionKey ?? "").trim();
        if (!key) return;
        evt.preventDefault();
        resolveOnce(key);
      }
    };

    const cleanup = () => {
      try {
        window.removeEventListener("keydown", onKeydown, true);
      } catch {}
      try {
        overlay.removeEventListener("click", onOverlayClick, true);
      } catch {}
      for (const { element, onClick } of buttonEntriesWithHandlers) {
        try {
          element.removeEventListener("click", onClick, true);
        } catch {}
      }
      try {
        if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      } catch {}
      try {
        root.style.overflow = previousOverflow;
      } catch {}
      activeModalCleanup = null;
      try {
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
      } catch {}
    };

    const buttonEntriesWithHandlers = buttonEntries.map(({ button, element }) => {
      const onClick = (evt: Event) => {
        evt.preventDefault();
        evt.stopPropagation();
        resolveOnce(button.key);
      };
      element.addEventListener("click", onClick, true);
      return { element, onClick };
    });

    activeModalCleanup = cleanup;

    overlay.addEventListener("click", onOverlayClick, true);
    window.addEventListener("keydown", onKeydown, true);

    document.body.appendChild(overlay);
    root.style.overflow = "hidden";

    await new Promise<void>((r) => setTimeout(r, 0));
    const autoFocusTarget =
      buttonEntries.find(({ button }) => button.autoFocus)?.element ?? buttonEntries[buttonEntries.length - 1]?.element;
    try {
      autoFocusTarget?.focus();
    } catch {
      try {
        modal.focus();
      } catch {}
    }
  });
}
