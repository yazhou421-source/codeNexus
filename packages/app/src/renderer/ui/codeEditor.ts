import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { LanguageDescription, type LanguageSupport, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorView, keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

type CreateWorkspaceEditorStateArgs = {
  doc: string;
  language: LanguageSupport | null;
  onDocChange: (doc: string) => void;
  onStateChange?: (state: EditorState) => void;
  onSave: () => void;
};

const languageCompartment = new Compartment();

const workspaceEditorHighlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword],
    color: "var(--we-cm-keyword)",
    fontWeight: "600",
  },
  { tag: [t.variableName, t.self, t.name], color: "var(--we-cm-variable)" },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: "var(--we-cm-definition)" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: "var(--we-cm-type)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--we-cm-property)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: "var(--we-cm-function)" },
  { tag: [t.string, t.special(t.string), t.url, t.regexp, t.escape], color: "var(--we-cm-string)" },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: "var(--we-cm-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--we-cm-comment)", fontStyle: "italic" },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: "var(--we-cm-meta)" },
  { tag: [t.operator, t.punctuation, t.separator], color: "var(--we-cm-operator)" },
  { tag: t.invalid, color: "var(--we-cm-invalid)", textDecoration: "underline wavy" },
]);

const workspaceEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--we-code-text)",
    backgroundColor: "var(--we-code-bg)",
  },
  "&.cm-editor.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "Consolas, 'SFMono-Regular', 'Cascadia Code', 'JetBrains Mono', monospace",
    lineHeight: "var(--we-cm-line-height)",
    fontSize: "var(--we-cm-font-size)",
  },
  ".cm-content": {
    minHeight: "100%",
    lineHeight: "var(--we-cm-line-height)",
    padding: "var(--we-cm-pad-top) 0 var(--we-cm-pad-bottom)",
    caretColor: "var(--we-cm-caret)",
  },
  ".cm-line": {
    lineHeight: "var(--we-cm-line-height)",
    padding: "0 var(--we-cm-pad-right) 0 var(--we-cm-pad-left)",
  },
  ".cm-gutters": {
    minWidth: "var(--we-cm-gutter-min-width)",
    borderRight: "1px solid color-mix(in srgb, var(--wf-border) 54%, transparent)",
    backgroundColor: "var(--we-code-gutter-bg)",
    color: "var(--we-code-gutter-text)",
    fontFamily: "Consolas, 'SFMono-Regular', 'Cascadia Code', 'JetBrains Mono', monospace",
    fontSize: "var(--we-cm-font-size)",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-gutterElement": {
    boxSizing: "border-box",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 var(--we-cm-gutter-pad-right) 0 5px",
    minWidth: "20px",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  ".cm-foldGutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    textAlign: "center",
    lineHeight: "1",
    padding: "0",
    cursor: "pointer",
  },
  ".cm-foldGutter .cm-gutterElement span": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    lineHeight: "1",
    transform: "translateY(0)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--we-cm-active-line-bg)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--we-cm-gutter-active-bg)",
    color: "var(--we-code-text)",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "var(--we-cm-selection-bg) !important",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--we-cm-caret)",
  },
  ".cm-panels": {
    backgroundColor: "var(--we-cm-panel-bg)",
    color: "var(--we-code-text)",
    borderColor: "var(--we-cm-panel-border)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottomWidth: "1px",
  },
  ".cm-search .cm-textfield": {
    minHeight: "28px",
    border: "1px solid var(--we-cm-panel-border)",
    borderRadius: "6px",
    backgroundColor: "var(--we-code-bg)",
    color: "var(--we-code-text)",
  },
  ".cm-button": {
    border: "1px solid var(--we-cm-panel-border)",
    borderRadius: "6px",
    background: "var(--we-chrome-bg)",
    color: "var(--we-code-text)",
  },
  ".cm-button:hover": {
    background: "var(--we-tab-close-hover-bg)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--we-cm-search-match-bg)",
    border: "1px solid var(--we-cm-search-match-border)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--we-cm-search-match-selected-bg)",
  },
  ".cm-tooltip": {
    border: "1px solid var(--we-cm-tooltip-border)",
    backgroundColor: "var(--we-cm-tooltip-bg)",
    color: "var(--we-code-text)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--we-cm-selection-bg)",
    color: "var(--we-code-text)",
  },
  ".cm-foldPlaceholder": {
    border: "1px solid var(--we-cm-fold-border)",
    borderRadius: "4px",
    backgroundColor: "var(--we-cm-fold-bg)",
    color: "var(--we-cm-fold-text)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "var(--we-cm-bracket-match-bg)",
    outline: "1px solid var(--we-cm-bracket-match-border)",
    color: "inherit",
  },
  ".cm-nonmatchingBracket": {
    backgroundColor: "var(--we-cm-bracket-error-bg)",
    outline: "1px solid var(--we-cm-bracket-error-border)",
    color: "inherit",
  },
});

function basenameFromPath(path: string): string {
  const normalized = String(path ?? "")
    .trim()
    .replace(/[\\/]+$/, "");
  if (!normalized) return "";
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function resolveLanguageDescription(path: string): LanguageDescription | null {
  const fileName = basenameFromPath(path) || String(path ?? "").trim();
  return (
    LanguageDescription.matchFilename(languages, fileName) ??
    LanguageDescription.matchFilename(languages, String(path ?? "").trim())
  );
}

export function getLanguageDisplayNameForPath(path: string): string {
  const description = resolveLanguageDescription(path);
  return description?.name || "纯文本";
}

const languageSupportPromiseByName = new Map<string, Promise<LanguageSupport | null>>();

export function getCachedLanguageSupportForPath(path: string): LanguageSupport | null {
  const description = resolveLanguageDescription(path);
  return description?.support ?? null;
}

export async function loadLanguageSupportForPath(path: string): Promise<LanguageSupport | null> {
  const description = resolveLanguageDescription(path);
  if (!description) return null;
  if (description.support) return description.support;

  const cacheKey = description.name;
  const existing = languageSupportPromiseByName.get(cacheKey);
  if (existing) return await existing;

  const pending = description
    .load()
    .then((support) => support)
    .catch(() => null)
    .finally(() => {
      languageSupportPromiseByName.delete(cacheKey);
    });

  languageSupportPromiseByName.set(cacheKey, pending);
  return await pending;
}

function createWorkspaceEditorExtensions(args: CreateWorkspaceEditorStateArgs): Extension[] {
  return [
    basicSetup,
    EditorState.tabSize.of(2),
    keymap.of([
      indentWithTab,
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          args.onSave();
          return true;
        },
      },
    ]),
    workspaceEditorTheme,
    syntaxHighlighting(workspaceEditorHighlightStyle),
    languageCompartment.of(args.language ? [args.language] : []),
    EditorView.updateListener.of((update) => {
      args.onStateChange?.(update.state);
      if (!update.docChanged) return;
      args.onDocChange(update.state.doc.toString());
    }),
  ];
}

export function createWorkspaceEditorState(args: CreateWorkspaceEditorStateArgs): EditorState {
  return EditorState.create({
    doc: args.doc,
    extensions: createWorkspaceEditorExtensions(args),
  });
}

export function reconfigureWorkspaceEditorLanguage(state: EditorState, language: LanguageSupport | null): EditorState {
  return state.update({
    effects: languageCompartment.reconfigure(language ? [language] : []),
  }).state;
}
