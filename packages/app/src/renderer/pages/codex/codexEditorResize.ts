import { useEffect } from "react";

type EditorResizeState = {
  startClientX: number;
  startWidthPx: number;
  previewWidthPx: number;
} | null;

type EditorResizeEffectArgs = {
  showEditorPane: boolean;
  editorResizeState: EditorResizeState;
  setEditorResizeState: (updater: (state: EditorResizeState) => EditorResizeState) => void;
  setEditorResizeGlobalStyles: (enabled: boolean) => void;
  clampEditorPreferredWidthPx: (value: number) => number;
  appShellStore: { setCenterEditorWidthPx: (value: number, opts?: { save?: boolean }) => void };
  centerWidth: number;
};

// Codex 编辑器分隔条拖拽副作用：从 App.tsx 抽出，仅服务 CodexPage。
export function useMemoEditorResizeEffects({
  showEditorPane,
  editorResizeState,
  setEditorResizeState,
  setEditorResizeGlobalStyles,
  clampEditorPreferredWidthPx,
  appShellStore,
  centerWidth,
}: EditorResizeEffectArgs) {
  useEffect(() => {
    if (showEditorPane) return;
    setEditorResizeState(() => null);
    setEditorResizeGlobalStyles(false);
  }, [showEditorPane, setEditorResizeState, setEditorResizeGlobalStyles]);

  useEffect(() => {
    if (!editorResizeState) return;
    const onPointerMove = (event: PointerEvent) => {
      setEditorResizeState((state) => {
        if (!state) return state;
        const deltaX = state.startClientX - event.clientX;
        return { ...state, previewWidthPx: clampEditorPreferredWidthPx(state.startWidthPx + deltaX) };
      });
    };
    const onPointerUp = () => {
      setEditorResizeState((state) => {
        if (state) {
          appShellStore.setCenterEditorWidthPx(clampEditorPreferredWidthPx(state.previewWidthPx), { save: true });
        }
        return null;
      });
      setEditorResizeGlobalStyles(false);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      setEditorResizeGlobalStyles(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorResizeState, appShellStore, centerWidth]);
}
