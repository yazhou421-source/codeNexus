import { Bot, ImagePlus, ListTodo, SendHorizontal, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type Ref } from "react";
import { useTranslation } from "react-i18next";
import type { CollaborationModeKind, ComposeImageAttachment, ComposeWorkspaceFileMention } from "../../../domain/types";
import {
  COMPOSE_FILE_TOKEN_CHAR,
  countComposeFileTokensBeforeOffset,
  createComposeFileMention,
  findComposeFileTokenOffsetByMentionIndex,
} from "../../../domain/composeFileMentions";
import { basenameFromPath } from "../../../domain/workspaceFiles";
import { hasWorkspaceFileDragData, readWorkspaceFileDragData } from "../../../domain/workspaceFileDrag";
import { useRuntimeStore, type SandboxMode } from "../../../stores/runtime.store";
import { useUserInputStore } from "../../../stores/userInput.store";
import ApprovalDock from "../../approval/ApprovalDock";
import UserInputDock from "../../userInput/UserInputDock";
import WaterBallProgress from "../../ui/WaterBallProgress";
import WaveText from "../../ui/WaveText";
import { resolveVscodeEntryIcon } from "../workspace/vscodeFileIcons";
import ComposerModelReasoningPicker from "./ComposerModelReasoningPicker";
import ComposerSandboxPicker from "./ComposerSandboxPicker";

type Option = string | { value: string; label: string; disabled?: boolean };
type ComposeDraftState = {
  composeInput: string;
  composeFileMentions: ComposeWorkspaceFileMention[];
};
type ComposerScrollSnapshot = { top: number; bottomOffset: number; overflow: boolean };
type CaretRangeDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

export type ComposerPanelProps = Omit<HTMLAttributes<HTMLDivElement>, "onInput"> & {
  composeInput?: string;
  composeAttachments?: ComposeImageAttachment[];
  composeFileMentions?: ComposeWorkspaceFileMention[];
  historyRewriteActive?: boolean;
  historyRewriteSource?: "history" | "queue";
  statusText?: string;
  composeMode?: CollaborationModeKind;
  model?: string;
  reasoningEffort?: string;
  sandboxMode?: SandboxMode;
  modelOptions?: readonly Option[];
  reasoningEffortOptions?: readonly Option[];
  sandboxModeOptions?: readonly Option[];
  sandboxRiskText?: string;
  serviceTierLabel?: string;
  contextUsageTooltip?: string;
  contextUsagePercent?: number;
  contextUsageLevel?: string;
  contextUsageTokensText?: string;
  isTurnRunning?: boolean;
  sendDisabled?: boolean;
  sendTitle?: string;
  interruptDisabled?: boolean;
  interruptTitle?: string;
  inputId?: string;
  inputPlaceholder?: string;
  variant?: "dock" | "inline";
  interactionOwnerId?: string;
  composerPanelRef?: Ref<HTMLDivElement>;
  composerInputRef?: Ref<HTMLDivElement>;
  onUpdateComposeInput?: (value: string) => void;
  "onUpdate:composeInput"?: (value: string) => void;
  onUpdateComposeFileMentions?: (value: ComposeWorkspaceFileMention[]) => void;
  "onUpdate:composeFileMentions"?: (value: ComposeWorkspaceFileMention[]) => void;
  onUpdateModel?: (value: string) => void;
  "onUpdate:model"?: (value: string) => void;
  onUpdateReasoningEffort?: (value: string) => void;
  "onUpdate:reasoningEffort"?: (value: string) => void;
  onUpdateSandboxMode?: (value: SandboxMode) => void;
  "onUpdate:sandboxMode"?: (value: SandboxMode) => void;
  onSetComposeMode?: (mode: CollaborationModeKind) => void;
  "onSet-compose-mode"?: (mode: CollaborationModeKind) => void;
  onComposerKeydown?: (event: React.KeyboardEvent<any>) => void;
  onPickImages?: () => void;
  "onPick-images"?: () => void;
  onPreviewAttachment?: (attachmentId: string) => void;
  onRemoveAttachment?: (attachmentId: string) => void;
  onCancelRewrite?: () => void;
  onSend?: () => void;
  onInterruptTurn?: () => void;
  "onInterrupt-turn"?: () => void;
  onInteract?: () => void;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else ref.current = value;
}

function isMentionTokenElement(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.composeMentionId != null;
}

function isMentionTokenSpacerElement(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.composeMentionSpacer === "true";
}

function isSameMention(left: ComposeWorkspaceFileMention, right: ComposeWorkspaceFileMention): boolean {
  return left.id === right.id && left.path === right.path && left.kind === right.kind;
}

function isSameComposeDraft(left: ComposeDraftState, right: ComposeDraftState): boolean {
  if (left.composeInput !== right.composeInput) return false;
  if (left.composeFileMentions.length !== right.composeFileMentions.length) return false;
  return left.composeFileMentions.every((mention, index) => isSameMention(mention, right.composeFileMentions[index]!));
}

function buildMentionTokenIcon(path: string, kind: "file" | "directory"): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = "composer-inline-file-token__icon";
  icon.setAttribute("aria-hidden", "true");
  const vscodeIcon = resolveVscodeEntryIcon(path, { isDirectory: kind === "directory" }) as { width?: number; height?: number; body: string };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${vscodeIcon.width ?? 16} ${vscodeIcon.height ?? 16}`);
  svg.setAttribute("width", "1em");
  svg.setAttribute("height", "1em");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = vscodeIcon.body;
  icon.append(svg);
  return icon;
}

function buildMentionTokenElement(mention: ComposeWorkspaceFileMention): HTMLSpanElement {
  const kind = mention.kind === "directory" ? "directory" : "file";
  const root = document.createElement("span");
  root.className = `composer-inline-file-token composer-inline-file-token--${kind}`;
  root.contentEditable = "false";
  root.dataset.composeMentionId = mention.id;
  root.dataset.composeMentionPath = mention.path;
  root.dataset.composeMentionKind = kind;
  const label = document.createElement("span");
  label.className = "composer-inline-file-token__label";
  label.textContent = basenameFromPath(mention.path) || mention.path;
  root.append(buildMentionTokenIcon(mention.path, kind), label);
  return root;
}

function buildMentionTokenSpacerElement(): HTMLSpanElement {
  const spacer = document.createElement("span");
  spacer.className = "composer-inline-file-token-spacer";
  spacer.contentEditable = "false";
  spacer.dataset.composeMentionSpacer = "true";
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}

function renderComposeDraftToDom(root: HTMLDivElement, draft: ComposeDraftState) {
  root.replaceChildren();
  let mentionIndex = 0;
  let textBuffer = "";
  const flushText = () => {
    if (!textBuffer) return;
    root.append(document.createTextNode(textBuffer));
    textBuffer = "";
  };
  for (const char of draft.composeInput) {
    if (char !== COMPOSE_FILE_TOKEN_CHAR) {
      textBuffer += char;
      continue;
    }
    flushText();
    const mention = draft.composeFileMentions[mentionIndex++] ?? null;
    if (!mention) continue;
    root.append(buildMentionTokenElement(mention), buildMentionTokenSpacerElement());
  }
  flushText();
  for (; mentionIndex < draft.composeFileMentions.length; mentionIndex += 1) {
    const mention = draft.composeFileMentions[mentionIndex];
    if (mention) root.append(buildMentionTokenElement(mention), buildMentionTokenSpacerElement());
  }
}

function readComposeDraftFromDom(root: HTMLDivElement): ComposeDraftState {
  const composeInputParts: string[] = [];
  const composeFileMentions: ComposeWorkspaceFileMention[] = [];
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      composeInputParts.push(child.textContent ?? "");
      continue;
    }
    if (child.nodeName === "BR") {
      composeInputParts.push("\n");
      continue;
    }
    if (isMentionTokenSpacerElement(child)) continue;
    if (!isMentionTokenElement(child)) {
      composeInputParts.push(child.textContent ?? "");
      continue;
    }
    const mention = createComposeFileMention(child.dataset.composeMentionPath ?? "", {
      id: child.dataset.composeMentionId ?? "",
      idPrefix: "compose-file",
    });
    if (!mention) continue;
    composeInputParts.push(COMPOSE_FILE_TOKEN_CHAR);
    composeFileMentions.push(mention);
  }
  const composeInput = composeInputParts.join("").replace(/\r\n?/g, "\n");
  if (composeFileMentions.length === 0 && composeInput === "\n" && root.childNodes.length === 1 && root.firstChild?.nodeName === "BR") {
    return { composeInput: "", composeFileMentions };
  }
  return { composeInput, composeFileMentions };
}

function getLogicalLengthOfNode(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node.nodeName === "BR") return 1;
  if (isMentionTokenSpacerElement(node)) return 0;
  if (isMentionTokenElement(node)) return 1;
  return Array.from(node.childNodes).reduce((total, child) => total + getLogicalLengthOfNode(child), 0);
}

function getLogicalOffsetFromDomPoint(root: HTMLDivElement, container: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  try {
    range.setEnd(container, offset);
  } catch {
    return root.textContent?.length ?? 0;
  }
  return Array.from(range.cloneContents().childNodes).reduce((total, child) => total + getLogicalLengthOfNode(child), 0);
}

function getCurrentSelectionOffset(root: HTMLDivElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return root.textContent?.length ?? 0;
  const range = selection.getRangeAt(0);
  return getLogicalOffsetFromDomPoint(root, range.startContainer, range.startOffset);
}

function captureComposerScrollSnapshot(root: HTMLDivElement): ComposerScrollSnapshot {
  const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
  return { top: root.scrollTop, bottomOffset: Math.max(0, maxScrollTop - root.scrollTop), overflow: maxScrollTop > 0 };
}

function restoreComposerScrollSnapshot(root: HTMLDivElement, snapshot: ComposerScrollSnapshot) {
  const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
  if (maxScrollTop <= 0) {
    root.scrollTop = 0;
    return;
  }
  root.scrollTop = snapshot.overflow ? Math.max(0, Math.min(maxScrollTop, maxScrollTop - snapshot.bottomOffset)) : Math.max(0, Math.min(maxScrollTop, snapshot.top));
}

export default function ComposerPanel({
  composeInput = "",
  composeAttachments = [],
  composeFileMentions = [],
  historyRewriteActive = false,
  historyRewriteSource = "history",
  statusText = "",
  composeMode = "default",
  model = "",
  reasoningEffort = "medium",
  sandboxMode = "workspace-write",
  modelOptions = [],
  reasoningEffortOptions = ["low", "medium", "high", "xhigh"],
  sandboxModeOptions = ["read-only", "workspace-write", "danger-full-access"],
  sandboxRiskText = "",
  serviceTierLabel = "",
  contextUsageTooltip = "",
  contextUsagePercent = 0,
  contextUsageLevel = "normal",
  contextUsageTokensText = "",
  isTurnRunning = false,
  sendDisabled = false,
  sendTitle = "Send",
  interruptDisabled = false,
  interruptTitle = "Interrupt",
  inputId = "input",
  inputPlaceholder,
  variant = "dock",
  interactionOwnerId,
  composerPanelRef,
  composerInputRef,
  onUpdateComposeInput,
  "onUpdate:composeInput": onUpdateComposeInputColon,
  onUpdateComposeFileMentions,
  "onUpdate:composeFileMentions": onUpdateComposeFileMentionsColon,
  onUpdateModel,
  "onUpdate:model": onUpdateModelColon,
  onUpdateReasoningEffort,
  "onUpdate:reasoningEffort": onUpdateReasoningEffortColon,
  onUpdateSandboxMode,
  "onUpdate:sandboxMode": onUpdateSandboxModeColon,
  onSetComposeMode,
  "onSet-compose-mode": onSetComposeModeKebab,
  onComposerKeydown,
  onPickImages,
  "onPick-images": onPickImagesKebab,
  onPreviewAttachment,
  onRemoveAttachment,
  onCancelRewrite,
  onSend,
  onInterruptTurn,
  "onInterrupt-turn": onInterruptTurnKebab,
  onInteract,
  onPaste,
  className,
  ...props
}: ComposerPanelProps) {
  const { t } = useTranslation();
  const runtimeStore = useRuntimeStore();
  const userInputStore = useUserInputStore();
  const inputRef = useRef<HTMLDivElement | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [, setWorkspaceFileDragDepth] = useState(0);
  const [isWorkspaceFileDragOver, setIsWorkspaceFileDragOver] = useState(false);
  const [selectedMentionId, setSelectedMentionId] = useState("");
  const pendingSelectionOffsetRef = useRef<number | null>(null);
  const pendingFocusAfterSyncRef = useRef(false);
  const mentionSignature = useMemo(() => composeFileMentions.map((mention) => `${mention.id}\u0001${mention.path}`).join("\u0002"), [composeFileMentions]);
  const hasPendingComposerUserInput = useMemo(() => {
    const threadId = String(runtimeStore.currentThreadId ?? "").trim();
    return Boolean(threadId && userInputStore.queueSizeForThread(threadId) > 0);
  }, [runtimeStore.currentThreadId, userInputStore]);
  const historyRewriteLabel = historyRewriteSource === "queue" ? t("composer.editQueuedMessage") : t("composer.rewriteHistoryMessage");

  const bindComposerInputRef = (element: HTMLDivElement | null) => {
    inputRef.current = element;
    assignRef(composerInputRef, element);
  };

  const getDraftFromProps = (): ComposeDraftState => ({
    composeInput: String(composeInput ?? ""),
    composeFileMentions: composeFileMentions.map((mention) => ({ ...mention })),
  });

  const resolveDomPointForOffset = (root: HTMLDivElement, offsetValue: number): { container: Node; offset: number } => {
    const offset = Math.max(0, Math.min(String(composeInput ?? "").length, Math.round(offsetValue)));
    let remaining = offset;
    const children = Array.from(root.childNodes);
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      const childLength = getLogicalLengthOfNode(child);
      if (remaining > childLength) {
        remaining -= childLength;
        continue;
      }
      if (child.nodeType === Node.TEXT_NODE) return { container: child, offset: Math.min(remaining, child.textContent?.length ?? 0) };
      if (isMentionTokenElement(child) || child.nodeName === "BR") {
        if (remaining <= 0) return { container: root, offset: index };
        if (isMentionTokenElement(child) && isMentionTokenSpacerElement(children[index + 1] ?? null)) return { container: root, offset: index + 2 };
        return { container: root, offset: index + 1 };
      }
      return { container: child, offset: Math.min(remaining, child.childNodes.length) };
    }
    return { container: root, offset: root.childNodes.length };
  };

  const focusComposerAtLogicalOffset = (offset: number) => {
    const root = inputRef.current;
    if (!root) return;
    root.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    const point = resolveDomPointForOffset(root, offset);
    const range = document.createRange();
    range.setStart(point.container, point.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const applySelectedMentionState = () => {
    const root = inputRef.current;
    if (!root) return;
    const activeMentionId = String(selectedMentionId ?? "").trim();
    for (const token of root.querySelectorAll<HTMLElement>("[data-compose-mention-id]")) {
      token.classList.toggle("is-selected", token.dataset.composeMentionId === activeMentionId);
    }
  };

  const syncDomFromProps = () => {
    const root = inputRef.current;
    if (!root) return;
    const draftFromProps = getDraftFromProps();
    const draftFromDom = readComposeDraftFromDom(root);
    const hasPhantomEmptyBreak =
      draftFromProps.composeInput === "" &&
      draftFromProps.composeFileMentions.length === 0 &&
      root.childNodes.length === 1 &&
      root.firstChild?.nodeName === "BR";
    if (isSameComposeDraft(draftFromProps, draftFromDom) && !hasPhantomEmptyBreak) {
      pendingSelectionOffsetRef.current = null;
      pendingFocusAfterSyncRef.current = false;
      applySelectedMentionState();
      return;
    }
    const shouldFocus = pendingFocusAfterSyncRef.current || document.activeElement === root;
    const nextOffset = shouldFocus
      ? Math.max(0, Math.min(draftFromProps.composeInput.length, pendingSelectionOffsetRef.current ?? draftFromProps.composeInput.length))
      : null;
    const scrollSnapshot = captureComposerScrollSnapshot(root);
    renderComposeDraftToDom(root, draftFromProps);
    restoreComposerScrollSnapshot(root, scrollSnapshot);
    pendingSelectionOffsetRef.current = null;
    pendingFocusAfterSyncRef.current = false;
    if (nextOffset != null) focusComposerAtLogicalOffset(nextOffset);
    applySelectedMentionState();
  };

  useEffect(() => {
    syncDomFromProps();
  }, [composeInput, mentionSignature]);

  useEffect(() => {
    applySelectedMentionState();
  }, [selectedMentionId]);

  const updateInput = (value: string) => {
    onUpdateComposeInput?.(value);
    onUpdateComposeInputColon?.(value);
  };
  const updateMentions = (value: ComposeWorkspaceFileMention[]) => {
    onUpdateComposeFileMentions?.(value);
    onUpdateComposeFileMentionsColon?.(value);
  };
  const emitComposeDraft = (nextDraft: ComposeDraftState, options?: { focusOffset?: number | null; focus?: boolean; selectedMentionId?: string }) => {
    pendingSelectionOffsetRef.current = options?.focusOffset ?? null;
    pendingFocusAfterSyncRef.current = Boolean(options?.focus || options?.focusOffset != null);
    setSelectedMentionId(String(options?.selectedMentionId ?? "").trim());
    updateInput(nextDraft.composeInput);
    updateMentions(nextDraft.composeFileMentions);
  };
  const syncComposeDraftFromDom = () => {
    const root = inputRef.current;
    if (!root) return;
    const nextDraft = readComposeDraftFromDom(root);
    const prevDraft = getDraftFromProps();
    if (isSameComposeDraft(prevDraft, nextDraft)) {
      applySelectedMentionState();
      return;
    }
    emitComposeDraft(nextDraft, { focusOffset: getCurrentSelectionOffset(root), focus: document.activeElement === root });
  };
  const insertTextAtSelection = (textValue: string) => {
    const root = inputRef.current;
    if (!root) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) focusComposerAtLogicalOffset(String(composeInput ?? "").length);
    const nextSelection = window.getSelection();
    const range = nextSelection?.rangeCount ? nextSelection.getRangeAt(0) : null;
    if (!range) return;
    range.deleteContents();
    const textNode = document.createTextNode(String(textValue ?? "").replace(/\r\n?/g, "\n"));
    range.insertNode(textNode);
    range.setStart(textNode, textNode.textContent?.length ?? 0);
    range.collapse(true);
    nextSelection?.removeAllRanges();
    nextSelection?.addRange(range);
  };
  const removeMentionAtIndex = (mentionIndexValue: number) => {
    if (!Number.isFinite(mentionIndexValue) || mentionIndexValue < 0) return;
    const mentionIndex = Math.round(mentionIndexValue);
    const mentionOffset = findComposeFileTokenOffsetByMentionIndex(composeInput, mentionIndex);
    if (mentionOffset < 0) return;
    emitComposeDraft(
      {
        composeInput: `${composeInput.slice(0, mentionOffset)}${composeInput.slice(mentionOffset + 1)}`,
        composeFileMentions: composeFileMentions.filter((_, index) => index !== mentionIndex),
      },
      { focus: true, focusOffset: mentionOffset },
    );
  };
  const getMentionIndexById = (mentionIdValue: string) => composeFileMentions.findIndex((mention) => mention.id === String(mentionIdValue ?? "").trim());
  const insertDroppedFiles = (paths: Array<{ path: string; kind?: ComposeWorkspaceFileMention["kind"] }>, offsetValue: number) => {
    const offset = Math.max(0, Math.min(String(composeInput ?? "").length, Math.round(offsetValue)));
    const insertedMentions = paths.map((item) => createComposeFileMention(item.path, { kind: item.kind })).filter((item): item is ComposeWorkspaceFileMention => Boolean(item));
    if (insertedMentions.length === 0) return;
    const mentionInsertIndex = countComposeFileTokensBeforeOffset(composeInput, offset);
    emitComposeDraft(
      {
        composeInput: `${composeInput.slice(0, offset)}${COMPOSE_FILE_TOKEN_CHAR.repeat(insertedMentions.length)}${composeInput.slice(offset)}`,
        composeFileMentions: [
          ...composeFileMentions.slice(0, mentionInsertIndex),
          ...insertedMentions,
          ...composeFileMentions.slice(mentionInsertIndex),
        ],
      },
      { focus: true, focusOffset: offset + insertedMentions.length },
    );
  };
  const getCaretOffsetFromPoint = (clientX: number, clientY: number): number => {
    const root = inputRef.current;
    if (!root) return String(composeInput ?? "").length;
    const doc = document as CaretRangeDocument;
    const caretPosition = doc.caretPositionFromPoint?.(clientX, clientY) ?? null;
    if (caretPosition?.offsetNode) return getLogicalOffsetFromDomPoint(root, caretPosition.offsetNode, caretPosition.offset);
    const range = doc.caretRangeFromPoint?.(clientX, clientY) ?? null;
    if (range) return getLogicalOffsetFromDomPoint(root, range.startContainer, range.startOffset);
    return getCurrentSelectionOffset(root);
  };
  const resetWorkspaceFileDragState = () => {
    setWorkspaceFileDragDepth(0);
    setIsWorkspaceFileDragOver(false);
  };
  const setComposeMode = (mode: CollaborationModeKind) => {
    onSetComposeMode?.(mode);
    onSetComposeModeKebab?.(mode);
  };

  const onComposerKeydownInternal = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const root = inputRef.current;
    const selection = window.getSelection();
    const isCollapsed = Boolean(selection?.rangeCount && selection.getRangeAt(0).collapsed);
    if (selectedMentionId && (event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault();
      const mentionIndex = getMentionIndexById(selectedMentionId);
      setSelectedMentionId("");
      if (mentionIndex >= 0) removeMentionAtIndex(mentionIndex);
      return;
    }
    if (root && isCollapsed && (event.key === "Backspace" || event.key === "Delete")) {
      const caretOffset = getCurrentSelectionOffset(root);
      const tokenOffset = event.key === "Backspace" ? caretOffset - 1 : caretOffset;
      if (tokenOffset >= 0 && composeInput[tokenOffset] === COMPOSE_FILE_TOKEN_CHAR) {
        event.preventDefault();
        removeMentionAtIndex(countComposeFileTokensBeforeOffset(composeInput, tokenOffset));
        return;
      }
    }
    if (event.key === "Enter" && event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      setSelectedMentionId("");
      insertTextAtSelection("\n");
      syncComposeDraftFromDom();
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) setSelectedMentionId("");
    onComposerKeydown?.(event);
  };

  const onComposerPasteInternal = (event: React.ClipboardEvent<HTMLDivElement>) => {
    onPaste?.(event);
    if (event.defaultPrevented) return;
    const text = String(event.clipboardData?.getData("text/plain") ?? "");
    if (!text) return;
    event.preventDefault();
    setSelectedMentionId("");
    insertTextAtSelection(text);
    syncComposeDraftFromDom();
  };

  const onComposerInputMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-compose-mention-id]") : null;
    if (!target) {
      if (selectedMentionId) setSelectedMentionId("");
      return;
    }
    event.preventDefault();
    const mentionId = String(target.dataset.composeMentionId ?? "").trim();
    const mentionIndex = getMentionIndexById(mentionId);
    if (mentionIndex < 0) return;
    const mentionOffset = findComposeFileTokenOffsetByMentionIndex(composeInput, mentionIndex);
    setSelectedMentionId(mentionId);
    if (mentionOffset >= 0) focusComposerAtLogicalOffset(mentionOffset + 1);
  };

  const send = () => onSend?.();
  const interrupt = () => {
    onInterruptTurn?.();
    onInterruptTurnKebab?.();
  };

  return (
    <div
      {...props}
      className={["composer", variant === "inline" ? "composer--inline" : "", className].filter(Boolean).join(" ")}
      data-composer-owner={interactionOwnerId || undefined}
      onPointerDownCapture={(event) => {
        onInteract?.();
        if (variant !== "inline" || event.button !== 0) return;
        const input = inputRef.current;
        const target = event.target instanceof Element ? event.target : null;
        if (!input || !target || input.contains(target) || !target.closest(".composer-toolbar")) return;
        event.preventDefault();
        setIsInputFocused(true);
      }}
      onFocusCapture={onInteract}
    >
      <div className="composer-input-area">
        <div
          ref={(element) => assignRef(composerPanelRef, element)}
          className={[
            "composer-shell",
            composeMode === "plan" ? "is-plan" : "is-agent",
            isWorkspaceFileDragOver ? "is-workspace-file-drag-over" : "",
            isInputFocused ? "is-focused" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const input = inputRef.current;
            const target = event.target instanceof Element ? event.target : null;
            if (!input || !target) return;
            if (target.closest("button,input,select,option,a,[role='combobox'],[role='button'],[role='menuitem'],[contenteditable='true']")) return;
            event.preventDefault();
            setSelectedMentionId("");
            focusComposerAtLogicalOffset(String(composeInput ?? "").length);
          }}
          onDragEnter={(event) => {
            if (!hasWorkspaceFileDragData(event.dataTransfer)) return;
            event.preventDefault();
            setWorkspaceFileDragDepth((value) => value + 1);
            setIsWorkspaceFileDragOver(true);
          }}
          onDragOver={(event) => {
            if (!hasWorkspaceFileDragData(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setIsWorkspaceFileDragOver(true);
          }}
          onDragLeave={(event) => {
            if (!hasWorkspaceFileDragData(event.dataTransfer)) return;
            const currentTarget = event.currentTarget;
            if (event.relatedTarget instanceof Node && currentTarget.contains(event.relatedTarget)) return;
            setWorkspaceFileDragDepth((value) => {
              const next = Math.max(0, value - 1);
              if (next === 0) setIsWorkspaceFileDragOver(false);
              return next;
            });
          }}
          onDrop={(event) => {
            if (!hasWorkspaceFileDragData(event.dataTransfer)) return;
            event.preventDefault();
            const files = readWorkspaceFileDragData(event.dataTransfer);
            resetWorkspaceFileDragState();
            if (files.length === 0) return;
            setSelectedMentionId("");
            insertDroppedFiles(files, getCaretOffsetFromPoint(event.clientX, event.clientY));
          }}
        >
          {variant !== "inline" ? <ApprovalDock /> : null}
          {variant !== "inline" && hasPendingComposerUserInput ? <UserInputDock /> : null}
          {isWorkspaceFileDragOver ? <div className="composer-file-drop-overlay" aria-hidden="true">{t("composer.dropFiles")}</div> : null}
          <div
            ref={bindComposerInputRef}
            id={inputId || "input"}
            className="composer-input-editor app-scrollbar"
            contentEditable
            role="textbox"
            aria-multiline="true"
            spellCheck={false}
            data-placeholder={inputPlaceholder || t("composer.inputPlaceholder")}
            onKeyDown={onComposerKeydownInternal}
            onPaste={onComposerPasteInternal}
            onInput={() => {
              setSelectedMentionId("");
              syncComposeDraftFromDom();
            }}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            onMouseDown={onComposerInputMouseDown}
          />

          {composeAttachments.length > 0 ? (
            <div className="composer-attachments">
              {composeAttachments.map((attachment) => (
                <div key={attachment.id} className="composer-attachment">
                  <button className="composer-attachment-preview" type="button" aria-label={t("composer.previewImage", { name: attachment.name })} onClick={() => onPreviewAttachment?.(attachment.id)}>
                    <img className="composer-attachment-image" src={attachment.previewUrl} alt={attachment.name} loading="lazy" />
                  </button>
                  <button className="composer-attachment-remove" type="button" aria-label={t("composer.removeImage")} onClick={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    onRemoveAttachment?.(attachment.id);
                  }}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="composer-toolbar">
            <div className="composer-toolbar-main">
              {historyRewriteActive && variant !== "inline" ? (
                <div className="composer-rewrite-chip mono">
                  <span>{historyRewriteLabel}</span>
                  <button className="btn-mini composer-rewrite-cancel" type="button" onClick={onCancelRewrite}>
                    {t("common.cancel")}
                  </button>
                </div>
              ) : null}
              <div className="composer-mode-group" role="group" aria-label={t("composer.collaborationMode")}>
                <div className="composer-mode-thumb" />
                <button className={["btn-mini composer-mode-button is-agent", composeMode === "default" ? "is-active" : ""].filter(Boolean).join(" ")} type="button" onClick={() => setComposeMode("default")}>
                  <Bot className="composer-mode-icon" aria-hidden="true" />
                  <span>{t("composer.execute")}</span>
                </button>
                <button className={["btn-mini composer-mode-button is-plan", composeMode === "plan" ? "is-active" : ""].filter(Boolean).join(" ")} type="button" onClick={() => setComposeMode("plan")}>
                  <ListTodo className="composer-mode-icon" aria-hidden="true" />
                  <span>{t("composer.plan")}</span>
                </button>
              </div>
              <ComposerModelReasoningPicker
                model={model}
                reasoningEffort={reasoningEffort}
                modelOptions={modelOptions}
                reasoningEffortOptions={reasoningEffortOptions}
                interactionOwnerId={interactionOwnerId}
                onUpdateModel={(value) => {
                  onUpdateModel?.(value);
                  onUpdateModelColon?.(value);
                }}
                onUpdateReasoningEffort={(value) => {
                  onUpdateReasoningEffort?.(value);
                  onUpdateReasoningEffortColon?.(value);
                }}
              />
              <ComposerSandboxPicker
                modelValue={sandboxMode}
                options={sandboxModeOptions}
                tooltipText={sandboxRiskText}
                interactionOwnerId={interactionOwnerId}
                onUpdateModelValue={(value) => {
                  onUpdateSandboxMode?.(value);
                  onUpdateSandboxModeColon?.(value);
                }}
              />
              {variant !== "inline" && serviceTierLabel ? <span className={["composer-service-tier mono", serviceTierLabel === t("composer.fast") ? "is-fast" : ""].filter(Boolean).join(" ")}>{serviceTierLabel}</span> : null}
            </div>

            <div className="composer-toolbar-actions">
              {variant !== "inline" ? (
                <button id="btn-add-image" className="btn-mini composer-icon-button" type="button" aria-label={t("composer.addImage")} onClick={() => {
                  onPickImages?.();
                  onPickImagesKebab?.();
                }}>
                  <ImagePlus className="composer-icon-button-icon" />
                </button>
              ) : null}
              {variant !== "inline" ? (
                <div className="composer-context">
                  <WaterBallProgress className="composer-context-ball" percent={contextUsagePercent} level={contextUsageLevel} size={28} animated={contextUsageLevel === "critical"} ariaLabel={contextUsageTooltip} />
                  <div className="composer-context-copy">
                    <div className="composer-context-tokens mono">{contextUsageTokensText}</div>
                  </div>
                </div>
              ) : null}
              <button id="btn-send-stop" className={["composer-send-button", isTurnRunning ? "is-running" : "", sendDisabled && !isTurnRunning ? "is-disabled" : ""].filter(Boolean).join(" ")} type="button" disabled={sendDisabled && !isTurnRunning} aria-label={sendTitle} onClick={send}>
                {!sendDisabled && !isTurnRunning ? <div className="composer-send-ping" /> : null}
                <SendHorizontal className="composer-send-icon" />
                <span className="composer-send-label">{t("composer.send")}</span>
              </button>
              {isTurnRunning ? (
                <button className="composer-send-button composer-stop-button is-running" type="button" disabled={interruptDisabled} aria-label={interruptTitle} onClick={interrupt}>
                  <Square className="composer-send-icon" />
                </button>
              ) : null}
            </div>
          </div>

          {statusText ? <div className="composer-status-line"><WaveText className="composer-status-text mono dim" text={statusText} /></div> : null}
        </div>
      </div>
    </div>
  );
}
