import { useEffect, useMemo, useRef } from "react";
import { getRuntimeOrchestrator } from "../../domain/runtimeOrchestrator";
import type { UserInputQuestion } from "../../domain/types";
import { useRuntimeStore } from "../../stores/runtime.store";
import { useUserInputStore } from "../../stores/userInput.store";
import { safeJsonStringify } from "../../utils/safeJson";

type UserInputDockProps = {
  threadId?: string;
  variant?: "composer" | "panel";
  className?: string;
};

type UserInputKeyboardTarget = {
  key: string;
  kind: "option" | "textInput";
  optionIndex?: number;
};

function optionTargetKey(optionIndex: number): string {
  return `option:${optionIndex}`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isEmptySchema(value: unknown) {
  const schema = toRecord(value);
  if (!schema || schema.type !== "object") return false;
  const properties = toRecord(schema.properties);
  if (!properties || Object.keys(properties).length > 0) return false;
  const required = Array.isArray(schema.required) ? schema.required.some((item) => String(item ?? "").trim()) : false;
  return !required;
}

export default function UserInputDock({ threadId, variant = "composer", className }: UserInputDockProps) {
  const runtime = getRuntimeOrchestrator();
  const runtimeStore = useRuntimeStore();
  const userInputStore = useUserInputStore();
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());
  const textRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const rememberedSelectedOptionByQuestion = useRef(new Map<string, string>());
  const resolvedThreadId = String(threadId ?? runtimeStore.currentThreadId ?? "").trim();
  const queueSize = resolvedThreadId ? userInputStore.queueSizeForThread(resolvedThreadId) : 0;
  const prompt = resolvedThreadId ? userInputStore.activePromptForThread(resolvedThreadId) : null;
  const step = resolvedThreadId ? userInputStore.activeStepForThread(resolvedThreadId) : 0;
  const question = prompt?.questions[Math.max(0, Math.min(step, prompt.questions.length - 1))] ?? null;
  const emptyElicitation = prompt?.kind === "elicitationForm" && isEmptySchema(prompt.requestedSchema);
  const multilineInput = prompt?.kind === "elicitationForm" && !emptyElicitation;
  const questionHasTextInput = Boolean(
    question &&
      !emptyElicitation &&
      (prompt?.kind === "elicitationForm" || question.isOther || question.options.length === 0 || question.isSecret)
  );
  const isLast = !prompt || prompt.kind !== "questions" || step >= prompt.questions.length - 1;
  const rootClass = [
    "grid gap-2.5",
    variant === "panel" ? "" : "border-b border-[color:var(--composer-divider)] pb-2",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const questionStateKey = (targetQuestion: UserInputQuestion) => {
    const requestId = String(prompt?.requestId ?? "").trim();
    return `${resolvedThreadId}:${requestId}:${targetQuestion.id}`;
  };

  const draftText = (targetQuestion: UserInputQuestion) => {
    if (!prompt || !resolvedThreadId) return "";
    const answers = userInputStore.getDraft(resolvedThreadId, prompt.requestId, targetQuestion.id);
    return (
      answers.find((answer) => !targetQuestion.options.some((option) => option.label === answer)) ??
      (targetQuestion.options.length === 0 ? (answers[0] ?? "") : "")
    );
  };

  const selectedOption = (targetQuestion: UserInputQuestion) => {
    if (!prompt || !resolvedThreadId) return "";
    const answers = userInputStore.getDraft(resolvedThreadId, prompt.requestId, targetQuestion.id);
    return targetQuestion.options.find((option) => answers.includes(option.label))?.label ?? "";
  };

  const selectedOptionIndex = (targetQuestion: UserInputQuestion) => {
    const selectedLabel = selectedOption(targetQuestion);
    if (!selectedLabel) return -1;
    return targetQuestion.options.findIndex((option) => option.label === selectedLabel);
  };

  const rememberedSelectedOption = (targetQuestion: UserInputQuestion) =>
    rememberedSelectedOptionByQuestion.current.get(questionStateKey(targetQuestion)) ?? "";

  const rememberSelectedOption = (targetQuestion: UserInputQuestion, label: string) => {
    const normalized = String(label ?? "").trim();
    if (!normalized) return;
    rememberedSelectedOptionByQuestion.current.set(questionStateKey(targetQuestion), normalized);
  };

  const setDraft = (targetQuestion: UserInputQuestion, answers: string[]) => {
    if (!prompt || !resolvedThreadId) return;
    userInputStore.setDraft(resolvedThreadId, prompt.requestId, targetQuestion.id, answers);
  };

  const selectOption = (targetQuestion: UserInputQuestion, label: string) => {
    rememberSelectedOption(targetQuestion, label);
    setDraft(targetQuestion, [label]);
  };

  const changeText = (targetQuestion: UserInputQuestion, rawValue: string) => {
    const value = String(rawValue ?? "").trim();
    const selected = rememberedSelectedOption(targetQuestion);
    if (!value) {
      setDraft(targetQuestion, selected ? [selected] : []);
      return;
    }
    setDraft(targetQuestion, [value]);
  };

  const activeTargets = useMemo<UserInputKeyboardTarget[]>(() => {
    if (!prompt || prompt.kind !== "questions" || !question) return [];
    const targets: UserInputKeyboardTarget[] = question.options.map((_, optionIndex) => ({
      key: optionTargetKey(optionIndex),
      kind: "option",
      optionIndex,
    }));
    if (questionHasTextInput) targets.push({ key: "textInput", kind: "textInput" });
    return targets;
  }, [prompt, question, questionHasTextInput]);

  const focusTarget = (targetKey: string) => {
    if (!targetKey) return false;
    if (targetKey === "textInput") {
      if (!textRef.current) return false;
      textRef.current.focus({ preventScroll: true });
      return true;
    }
    if (!targetKey.startsWith("option:")) return false;
    const optionIndex = Number.parseInt(targetKey.slice("option:".length), 10);
    const optionEl = Number.isFinite(optionIndex) ? (optionRefs.current.get(optionIndex) ?? null) : null;
    if (!optionEl) return false;
    optionEl.focus({ preventScroll: true });
    return true;
  };

  const scheduleFocusTarget = (targetKey: string) => {
    if (!targetKey) return;
    window.setTimeout(() => {
      focusTarget(targetKey);
    }, 0);
  };

  const initialTargetKey = (targetQuestion: UserInputQuestion | null) => {
    if (!targetQuestion) return "";
    if (questionHasTextInput && draftText(targetQuestion)) return "textInput";
    const optionIndex = selectedOptionIndex(targetQuestion);
    if (optionIndex >= 0) return optionTargetKey(optionIndex);
    if (targetQuestion.options.length > 0) return optionTargetKey(0);
    if (questionHasTextInput) return "textInput";
    return "";
  };

  const moveFocus = (fromTargetKey: string, delta: -1 | 1) => {
    if (!question) return;
    const currentIndex = activeTargets.findIndex((target) => target.key === fromTargetKey);
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= activeTargets.length) return;
    const nextTarget = activeTargets[nextIndex] ?? null;
    if (!nextTarget) return;
    if (nextTarget.kind === "option" && Number.isFinite(nextTarget.optionIndex)) {
      const nextOption = question.options[nextTarget.optionIndex!];
      if (nextOption?.label) selectOption(question, nextOption.label);
    }
    scheduleFocusTarget(nextTarget.key);
  };

  const answered = useMemo(() => {
    if (!prompt || !question || !resolvedThreadId) return prompt?.kind === "elicitationUrl" || emptyElicitation;
    if (prompt.kind === "elicitationUrl" || emptyElicitation) return true;
    return userInputStore.isQuestionAnswered(resolvedThreadId, question.id);
  }, [prompt, question, resolvedThreadId, emptyElicitation, userInputStore]);

  const canGoPrev = Boolean(prompt?.kind === "questions" && resolvedThreadId && step > 0);
  const canGoNext = Boolean(prompt?.kind === "elicitationUrl" || emptyElicitation || answered);

  useEffect(() => {
    if (!prompt || prompt.kind !== "questions" || !question) return;
    const selectedLabel = selectedOption(question);
    if (selectedLabel) rememberSelectedOption(question, selectedLabel);
    scheduleFocusTarget(initialTargetKey(question));
  }, [resolvedThreadId, prompt?.requestId, question?.id]);

  if (queueSize <= 0) return null;

  const submitOrNext = async () => {
    if (!prompt || !resolvedThreadId) return;
    if (prompt.kind !== "elicitationUrl" && !canGoNext) return;
    if (prompt.kind === "elicitationUrl") {
      await runtime.submitUserInputPromptForThread(resolvedThreadId);
      return;
    }
    if (!isLast) {
      userInputStore.nextStep(resolvedThreadId);
      return;
    }
    await runtime.submitUserInputPromptForThread(resolvedThreadId);
  };

  const prevStep = () => {
    if (!resolvedThreadId) return;
    userInputStore.prevStep(resolvedThreadId);
  };

  const header =
    prompt?.kind === "elicitationForm" || prompt?.kind === "elicitationUrl"
      ? `MCP · ${prompt.serverName ?? ""}`
      : question?.header ?? "";
  const questionText =
    prompt?.kind === "elicitationForm" || prompt?.kind === "elicitationUrl"
      ? String(prompt.message ?? "")
      : question?.question ?? "";
  const progress =
    prompt?.kind === "elicitationUrl"
      ? "链接确认"
      : emptyElicitation
        ? "确认"
        : prompt?.kind === "elicitationForm"
          ? "JSON 输入"
          : prompt
            ? `${Math.min(step + 1, prompt.questions.length)}/${prompt.questions.length}`
            : "0/0";
  const textPlaceholder =
    prompt?.kind === "elicitationForm"
      ? `请输入 JSON，例如 {"key":"value"}`
      : question?.isOther
        ? "请输入其他内容"
        : "请输入答案";
  const submitText = !prompt
    ? "提交"
    : prompt.kind === "elicitationUrl"
      ? "已完成"
      : emptyElicitation
        ? "确认"
        : prompt.kind === "elicitationForm"
          ? "提交 JSON"
          : isLast
            ? "提交"
            : "下一步";

  return (
    <div className={rootClass} role="region" aria-label="计划问答">
      <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <span className="attn-dot" aria-hidden="true" />
          <div className="text-[12px] font-semibold tracking-[0.2px] text-[color:var(--text)]">计划问答</div>
        </div>
        <span className="mono dim text-[11px]">{queueSize > 0 ? `待输入 ${queueSize}` : "0"}</span>
      </div>

      <div id={`user-input-box:${resolvedThreadId || "no-thread"}`} className={prompt ? "" : "dim"}>
        {!prompt ? (
          "当前无待回答问题"
        ) : (
          <div className="user-input-card">
            <div className="user-input-head">
              <div className="user-input-header">{header}</div>
              <div className="user-input-progress mono dim">{progress}</div>
            </div>
            <div className="user-input-question">{questionText}</div>

            {prompt.kind === "elicitationUrl" ? (
              <div className="grid gap-2 rounded-xl border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] p-2">
                <div className="dim text-[11px]">请在浏览器中完成外部确认，然后回到这里继续。</div>
                <div className="mono text-[11px] break-all">{prompt.url}</div>
              </div>
            ) : null}

            {prompt.kind === "elicitationForm" && !emptyElicitation ? (
              <pre className="mono max-h-[180px] overflow-auto app-scrollbar rounded-xl border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2 text-[11px] whitespace-pre-wrap [overflow-wrap:anywhere] break-words">
                {safeJsonStringify(prompt.requestedSchema ?? null, { space: 2 })}
              </pre>
            ) : null}

            {question && question.options.length > 0 ? (
              <div className="user-input-options">
                {question.options.map((option, index) => {
                  const selected = selectedOption(question) === option.label;
                  return (
                    <button
                      key={`${question.id}:${option.label}:${index}`}
                      ref={(element) => {
                        if (element) optionRefs.current.set(index, element);
                        else optionRefs.current.delete(index);
                      }}
                      type="button"
                      className={`user-input-option${selected ? " selected" : ""}`}
                      onClick={() => selectOption(question, option.label)}
                      onKeyDown={(event) => {
                        if (prompt.kind !== "questions") return;
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          moveFocus(optionTargetKey(index), 1);
                          return;
                        }
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          moveFocus(optionTargetKey(index), -1);
                          return;
                        }
                        if (event.key === "ArrowLeft") {
                          event.preventDefault();
                          prevStep();
                          return;
                        }
                        if (event.key === "ArrowRight" || event.key === "Enter") {
                          event.preventDefault();
                          event.stopPropagation();
                          selectOption(question, option.label);
                          void submitOrNext();
                        }
                      }}
                    >
                      <span>{option.label}</span>
                      {option.description ? <span className="user-input-option-description">{option.description}</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {multilineInput && question ? (
              <textarea
                ref={(element) => {
                  textRef.current = element;
                }}
                className="user-input-text"
                rows={6}
                placeholder={textPlaceholder}
                value={draftText(question)}
                onChange={(event) => changeText(question, event.currentTarget.value)}
              />
            ) : question && (question.isOther || question.options.length === 0 || question.isSecret) ? (
              <input
                ref={(element) => {
                  textRef.current = element;
                }}
                className="user-input-text"
                type={question.isSecret ? "password" : "text"}
                placeholder={textPlaceholder}
                value={draftText(question)}
                onChange={(event) => changeText(question, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveFocus("textInput", -1);
                    return;
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveFocus("textInput", 1);
                    return;
                  }
                  if (event.key !== "Enter" || event.nativeEvent.isComposing || !canGoNext) return;
                  event.preventDefault();
                  event.stopPropagation();
                  void submitOrNext();
                }}
              />
            ) : null}

            <div className="user-input-actions">
              <button className="danger" type="button" onClick={() => void runtime.cancelUserInputPromptForThread(resolvedThreadId)}>
                取消
              </button>
              {prompt.kind === "elicitationUrl" ? (
                <button type="button" onClick={() => void runtime.openExternalUrl(prompt.url)}>
                  打开链接
                </button>
              ) : (
                <button type="button" disabled={!canGoPrev} onClick={prevStep}>
                  上一步
                </button>
              )}
              <button type="button" disabled={!canGoNext} onClick={() => void submitOrNext()}>
                {submitText}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
