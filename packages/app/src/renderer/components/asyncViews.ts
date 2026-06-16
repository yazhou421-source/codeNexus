import { lazy } from "react";

export const DebugTimelineSidebar = lazy(() => import("./layout/debug/DebugTimelineSidebar"));
export const AppClosingOverlay = lazy(() => import("./layout/overlays/AppClosingOverlay"));
export const GoalShutdownCountdownOverlay = lazy(() => import("./layout/overlays/GoalShutdownCountdownOverlay"));
export const LeftSidebar = lazy(() => import("./layout/LeftSidebar"));
export const SettingsPage = lazy(() => import("./layout/SettingsPage"));
export const WorkspaceEditorPane = lazy(() => import("./layout/workspace/WorkspaceEditorPane"));
export const WorkspaceFilesSidebar = lazy(() => import("./layout/workspace/WorkspaceFilesSidebar"));
export const ComposerQueueList = lazy(() => import("./layout/composer/ComposerQueueList"));
export const ComposerSlashCommandList = lazy(() => import("./layout/composer/ComposerSlashCommandList"));
export const SkillsManagerOverlay = lazy(() => import("./layout/skills/SkillsManagerOverlay"));
export const ChatPane = lazy(() => import("./layout/chat/ChatPane"));
