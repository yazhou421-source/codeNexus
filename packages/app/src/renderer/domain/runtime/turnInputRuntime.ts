import { codexDesktop } from "../../api/codexDesktopClient";
import {
  buildComposeDraftFromUserTurnInputs,
  cloneComposeTextElements,
  cloneProtocolTextElements,
  buildUserTurnInputsFromComposeDraft,
} from "../composeFileMentions";
import type { UserInput as CodexUserInput } from "@codenexus/generated/codex-app-server/v2/UserInput";
import type {
  ComposeImageAttachment,
  ComposeWorkspaceFileMention,
  TimelineUserMessageParams,
  UserTurnInput,
} from "../types";

export type TurnInputRuntime = {
  cloneUserTurnInput: (value: UserTurnInput) => UserTurnInput;
  cloneUserTurnInputs: (values: UserTurnInput[]) => UserTurnInput[];
  toCodexUserInputs: (values: UserTurnInput[]) => CodexUserInput[];
  fileNameFromPathLike: (value: string, fallback: string) => string;
  buildComposeAttachmentsFromUserTurnInputs: (
    values: UserTurnInput[]
  ) => Promise<{ attachments: ComposeImageAttachment[]; failedLocalPaths: string[] }>;
  buildTimelineUserMessagePayload: (values: UserTurnInput[]) => {
    displayText: string;
    payload: TimelineUserMessageParams;
  };
  buildUserTurnInput: (
    composeInput: string,
    attachments: ComposeImageAttachment[],
    mentions: ComposeWorkspaceFileMention[]
  ) => UserTurnInput[];
  summarizeLocalUserMessage: (values: UserTurnInput[]) => {
    displayText: string;
    payload: TimelineUserMessageParams;
  };
};

function parseImageMimeTypeFromDataUrl(value: string): string {
  const match = String(value ?? "")
    .trim()
    .match(/^data:(image\/[^;]+);base64,/i);
  return String(match?.[1] ?? "image/png").toLowerCase();
}

function imageExtensionFromMimeType(mimeTypeValue: string): string {
  const mimeType = String(mimeTypeValue ?? "")
    .trim()
    .toLowerCase();
  if (!mimeType) return "png";
  if (mimeType.includes("jpeg")) return "jpg";
  const ext = mimeType.split("/")[1] ?? "png";
  const normalized = ext.replace(/[^a-z0-9.+-]/gi, "");
  return normalized || "png";
}

export function fileNameFromPathLike(value: string, fallback: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return fallback;
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || fallback;
}

export function createTurnInputRuntime(): TurnInputRuntime {
  const cloneUserTurnInput = (value: UserTurnInput): UserTurnInput => {
    if (value.type === "text") {
      return {
        type: "text",
        text: String(value.text ?? ""),
        ...(Array.isArray(value.text_elements) ? { text_elements: cloneComposeTextElements(value.text_elements) } : {}),
      };
    }
    if (value.type === "image") {
      return { type: "image", url: String(value.url ?? "") };
    }
    return { type: "localImage", path: String(value.path ?? "") };
  };

  const cloneUserTurnInputs = (values: UserTurnInput[]): UserTurnInput[] => {
    if (!Array.isArray(values) || values.length === 0) return [];
    return values.map((value) => cloneUserTurnInput(value));
  };

  const toCodexUserInputs = (values: UserTurnInput[]): CodexUserInput[] => {
    return cloneUserTurnInputs(values).map((value) => {
      if (value.type === "text") {
        return {
          type: "text",
          text: String(value.text ?? ""),
          text_elements: cloneProtocolTextElements(value.text_elements),
        };
      }
      if (value.type === "image") {
        return { type: "image", url: String(value.url ?? "") };
      }
      return { type: "localImage", path: String(value.path ?? "") };
    });
  };

  const buildComposeAttachmentFromImageUrl = (urlValue: string, imageIndex: number): ComposeImageAttachment | null => {
    const url = String(urlValue ?? "").trim();
    if (!url) return null;
    const mimeType = url.startsWith("data:image/") ? parseImageMimeTypeFromDataUrl(url) : "image/*";
    const extension = imageExtensionFromMimeType(mimeType);
    const base64 = url.startsWith("data:") && url.includes(",") ? url.slice(url.indexOf(",") + 1) : "";
    const estimatedSize = base64 ? Math.max(0, Math.floor((base64.length * 3) / 4)) : 0;
    return {
      id: `queue-image:${Date.now()}:${imageIndex}:${Math.random().toString(16).slice(2)}`,
      name: `queue-image-${imageIndex + 1}.${extension}`,
      size: estimatedSize,
      mimeType,
      previewUrl: url,
      revokePreviewUrlOnDispose: false,
      input: { type: "image", url },
    };
  };

  const buildComposeAttachmentFromLocalImagePath = async (
    pathValue: string,
    imageIndex: number
  ): Promise<ComposeImageAttachment | null> => {
    const filePath = String(pathValue ?? "").trim();
    if (!filePath) return null;
    const result = await codexDesktop.app.readImageFileDataUrl({ path: filePath });
    const dataUrl = String(result?.dataUrl ?? "").trim();
    if (!dataUrl) return null;
    return {
      id: `queue-local-image:${Date.now()}:${imageIndex}:${Math.random().toString(16).slice(2)}`,
      name: fileNameFromPathLike(filePath, `queue-image-${imageIndex + 1}.png`),
      size: 0,
      mimeType: parseImageMimeTypeFromDataUrl(dataUrl),
      previewUrl: dataUrl,
      revokePreviewUrlOnDispose: false,
      input: { type: "localImage", path: filePath },
    };
  };

  const buildComposeAttachmentsFromUserTurnInputs = async (
    values: UserTurnInput[]
  ): Promise<{ attachments: ComposeImageAttachment[]; failedLocalPaths: string[] }> => {
    const attachments: ComposeImageAttachment[] = [];
    const failedLocalPaths: string[] = [];
    let imageIndex = 0;
    for (const value of Array.isArray(values) ? values : []) {
      if (!value) continue;
      if (value.type === "image") {
        const attachment = buildComposeAttachmentFromImageUrl(value.url, imageIndex);
        imageIndex += 1;
        if (attachment) attachments.push(attachment);
        continue;
      }
      if (value.type !== "localImage") continue;
      const filePath = String(value.path ?? "").trim();
      try {
        const attachment = await buildComposeAttachmentFromLocalImagePath(filePath, imageIndex);
        if (attachment) attachments.push(attachment);
        else if (filePath) failedLocalPaths.push(filePath);
      } catch {
        if (filePath) failedLocalPaths.push(filePath);
      }
      imageIndex += 1;
    }
    return { attachments, failedLocalPaths };
  };

  const buildTimelineUserMessagePayload = (
    values: UserTurnInput[]
  ): {
    displayText: string;
    payload: TimelineUserMessageParams;
  } => {
    const normalizedInputs = cloneUserTurnInputs(values);
    const draft = buildComposeDraftFromUserTurnInputs(normalizedInputs);
    const textInput = buildUserTurnInputsFromComposeDraft(draft.composeInput, draft.composeFileMentions).find(
      (item): item is Extract<UserTurnInput, { type: "text" }> => item.type === "text"
    ) ?? { type: "text", text: "", text_elements: [] };

    const images = normalizedInputs
      .filter((item): item is Extract<UserTurnInput, { type: "image" }> => item.type === "image")
      .map((item) => String(item.url ?? ""));
    const localImages = normalizedInputs
      .filter((item): item is Extract<UserTurnInput, { type: "localImage" }> => item.type === "localImage")
      .map((item) => String(item.path ?? ""));

    const imageCount = images.length + localImages.length;
    const baseText = String(textInput.text ?? "");
    const imageSummary = imageCount > 0 ? `（附图 ${imageCount} 张）` : "";
    const displayText = baseText ? (imageSummary ? `${baseText}\n${imageSummary}` : baseText) : imageSummary;

    return {
      displayText,
      payload: {
        role: "user",
        text: baseText,
        ...(Array.isArray(textInput.text_elements) && textInput.text_elements.length > 0
          ? { text_elements: cloneComposeTextElements(textInput.text_elements) }
          : {}),
        images: images.length > 0 ? [...images] : null,
        local_images: [...localImages],
      },
    };
  };

  const buildUserTurnInput = (
    composeInput: string,
    attachments: ComposeImageAttachment[],
    mentions: ComposeWorkspaceFileMention[]
  ): UserTurnInput[] => {
    const result: UserTurnInput[] = buildUserTurnInputsFromComposeDraft(composeInput, mentions);
    const seen = new Set<string>();

    for (const attachment of attachments) {
      const input = attachment.input;
      if (input.type === "localImage") {
        const path = String(input.path ?? "").trim();
        if (!path) continue;
        const key = `localImage:${path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ type: "localImage", path });
        continue;
      }

      const url = String(input.url ?? "").trim();
      if (!url) continue;
      const key = `image:${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ type: "image", url });
    }

    return result;
  };

  const summarizeLocalUserMessage = (
    values: UserTurnInput[]
  ): { displayText: string; payload: TimelineUserMessageParams } => {
    return buildTimelineUserMessagePayload(values);
  };

  return {
    cloneUserTurnInput,
    cloneUserTurnInputs,
    toCodexUserInputs,
    fileNameFromPathLike,
    buildComposeAttachmentsFromUserTurnInputs,
    buildTimelineUserMessagePayload,
    buildUserTurnInput,
    summarizeLocalUserMessage,
  };
}
