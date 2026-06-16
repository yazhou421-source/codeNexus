import "@xyflow/react/dist/style.css";
import "./flowchart-workbench.css";

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import { toSvg } from "html-to-image";
import {
  ArrowRight,
  ClipboardPaste,
  Circle,
  CornerDownRight,
  Copy,
  Database,
  Diamond,
  Download,
  GitBranch,
  Loader2,
  Minus,
  Network,
  Plus,
  RectangleHorizontal,
  Redo2,
  Rows3,
  SplitSquareHorizontal,
  Square,
  Trash2,
  Type,
  Undo2,
  UserRound,
  Wand2,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  createDefaultFlowchartDocument,
  FLOWCHART_TEMPLATE_TYPES,
  normalizeFlowchartDocument,
  normalizeFlowchartEdgeType,
  type FlowchartDocument,
  type FlowchartEdge,
  type FlowchartEdgeType,
  type FlowchartNode as FlowchartDocNode,
  type FlowchartTemplateType,
} from "../../types";
import {
  deleteFlowchartHistory,
  listFlowchartHistory,
  openFlowchartSettings,
  runFlowchartAi,
  showFlowchartToast,
  upsertFlowchartHistory,
} from "../runtimeBridge";

type FlowchartWorkbenchProps = {
  className?: string;
  children?: ReactNode;
};

type ShapeNodeData = {
  label: string;
  nodeType: string;
  style: FlowchartDocNode["style"];
  connectable: boolean;
} & Record<string, unknown>;

type ShapeNode = Node<ShapeNodeData, "flowchartShape">;
type ShapeEdge = Edge<Record<string, unknown>>;
type FrameNodeType = "frame" | "lane-frame" | "system-frame" | "phase-frame";
type ShapeNodeType = "rectangle" | "rounded-rectangle" | "diamond" | "ellipse" | "text" | "database" | "actor";
type EdgePresetType = "straight-line" | "straight-arrow" | "smoothstep-arrow";
type PaletteDragState = { kind: "shape"; type: ShapeNodeType } | { kind: "frame"; type: FrameNodeType } | { kind: "edge"; type: EdgePresetType };
type EdgePreset = {
  kind: EdgePresetType;
  type: FlowchartEdgeType;
  markerEnd: boolean;
  label: string;
  icon: typeof Minus;
};
type ConnectionToolState = {
  preset: EdgePreset;
  stage: "select-source" | "select-target";
  sourceId: string | null;
  sourceLabel: string;
};
type ClipboardState = {
  nodes: FlowchartDocNode[];
  edges: FlowchartEdge[];
};

const FRAME_NODE_TYPES = new Set(["frame", "lane-frame", "system-frame", "phase-frame"]);
const GRID_UNIT = 20;
const GRID_LAYOUT_CELL = { width: 220, height: 140 };
const FLOW_SNAP_GRID: [number, number] = [20, 20];
const FLOW_MULTI_SELECTION_KEY_CODES = ["Shift"];

const templateIconByType: Record<FlowchartTemplateType, typeof Workflow> = {
  basic: Workflow,
  swimlane: Rows3,
  architecture: Network,
  org: SplitSquareHorizontal,
  sequence: GitBranch,
};

const templateLabelByType: Record<FlowchartTemplateType, string> = {
  basic: "基础流程",
  swimlane: "泳道流程",
  architecture: "系统架构",
  org: "组织结构",
  sequence: "时序图",
};

function nowId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function snap(value: number) {
  return Math.round(value / GRID_UNIT) * GRID_UNIT;
}

function cssColor(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function nodeSize(node: FlowchartDocNode) {
  return {
    width: Number(node.style.width) || (FRAME_NODE_TYPES.has(node.type) ? 420 : 160),
    height: Number(node.style.height) || (FRAME_NODE_TYPES.has(node.type) ? 240 : 72),
  };
}

function isFrameType(type: string) {
  return FRAME_NODE_TYPES.has(type);
}

function isConnectableNodeType(type?: string) {
  return Boolean(type && !isFrameType(type) && type !== "text");
}

function normalizeNodeType(type: string) {
  if (type === "process") return "rectangle";
  if (type === "decision") return "diamond";
  if (type === "start" || type === "end") return "ellipse";
  if (type === "person") return "actor";
  if (type === "lane") return "lane-frame";
  if (type === "system" || type === "lifeline") return "rounded-rectangle";
  return type || "rectangle";
}

function toNodeStyle(node: FlowchartDocNode) {
  const size = nodeSize(node);
  return {
    width: size.width,
    height: size.height,
  };
}

function toGraphNodes(document: FlowchartDocument): ShapeNode[] {
  return document.nodes.map((node) => ({
    id: node.id,
    type: "flowchartShape",
    position: node.position,
    parentId: node.parentId ?? undefined,
    data: {
      label: node.label,
      nodeType: normalizeNodeType(node.type),
      style: node.style,
      connectable: isConnectableNodeType(node.type),
    },
    selected: false,
    style: toNodeStyle(node),
  }));
}

function toGraphEdges(document: FlowchartDocument): ShapeEdge[] {
  return document.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: normalizeFlowchartEdgeType(edge.type),
    markerEnd: edge.markerEnd === false ? undefined : { type: MarkerType.ArrowClosed },
    style: {
      stroke: String(edge.style.stroke ?? "#64748b"),
      strokeWidth: Number(edge.style.strokeWidth) || 2,
    },
    selected: false,
  }));
}

function fromGraph(document: FlowchartDocument, nodes: ShapeNode[], edges: ShapeEdge[]): FlowchartDocument {
  return {
    ...document,
    nodes: document.nodes.map((docNode) => {
      const graphNode = nodes.find((node) => node.id === docNode.id);
      return graphNode ? { ...docNode, parentId: graphNode.parentId ?? null, position: graphNode.position } : docNode;
    }),
    edges: edges
      .filter((edge) => edge.source && edge.target)
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: String(edge.label ?? ""),
        type: edge.type === "straight" ? "straight" : "smoothstep",
        markerEnd: Boolean(edge.markerEnd),
        style: {
          stroke: String(edge.style?.stroke ?? "#64748b"),
          strokeWidth: Number(edge.style?.strokeWidth) || 2,
        },
      })),
    updatedAt: Date.now(),
  };
}

function cloneDocument(document: FlowchartDocument): FlowchartDocument {
  return normalizeFlowchartDocument(JSON.parse(JSON.stringify(document)), document).document;
}

function downloadText(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatTime(value: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function FlowchartShapeNode({ data, selected }: NodeProps<ShapeNode>) {
  const nodeType = String(data.nodeType ?? "rectangle");
  const style = data.style ?? {};
  const surfaceStyle = {
    "--flowchart-node-bg": String(style.backgroundColor ?? "color-mix(in srgb, var(--accent) 10%, var(--surface-1) 90%)"),
    "--flowchart-node-border": String(style.borderColor ?? "color-mix(in srgb, var(--accent) 42%, var(--border) 58%)"),
    "--flowchart-node-color": "var(--text)",
    borderStyle: String(style.borderStyle ?? "solid"),
  } as React.CSSProperties;
  return (
    <div
      className={[
        "flowchart-shape-node",
        `flowchart-shape-node--${nodeType}`,
        !data.label ? "is-empty" : "",
        data.connectable ? "is-connectable" : "",
        selected ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={surfaceStyle}
    >
      {data.connectable ? <Handle type="target" position={Position.Top} /> : null}
      {data.connectable ? <Handle type="source" position={Position.Bottom} /> : null}
      <div className="flowchart-shape-node__surface">
        {data.label ? <span className="flowchart-shape-node__label">{data.label}</span> : null}
      </div>
    </div>
  );
}

export default function FlowchartWorkbench({ className, children }: FlowchartWorkbenchProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const latestDocumentRef = useRef<FlowchartDocument | null>(null);
  const pendingSaveDocumentRef = useRef<FlowchartDocument | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<FlowchartTemplateType>("basic");
  const [currentDocument, setCurrentDocument] = useState<FlowchartDocument>(() => createDefaultFlowchartDocument("basic"));
  const [historyItems, setHistoryItems] = useState<FlowchartDocument[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [connectionTool, setConnectionTool] = useState<ConnectionToolState | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<ClipboardState>({ nodes: [], edges: [] });
  const [undoStack, setUndoStack] = useState<FlowchartDocument[]>([]);
  const [redoStack, setRedoStack] = useState<FlowchartDocument[]>([]);
  const [nodes, setNodes] = useNodesState<ShapeNode>(toGraphNodes(currentDocument));
  const [edges, setEdges] = useEdgesState<ShapeEdge>(toGraphEdges(currentDocument));
  const nodeTypes = useMemo(() => ({ flowchartShape: FlowchartShapeNode }), []);

  const templates = useMemo(
    () =>
      FLOWCHART_TEMPLATE_TYPES.map((type) => ({
        type,
        label: templateLabelByType[type],
        icon: templateIconByType[type],
      })),
    []
  );
  const shapePresets = useMemo(
    () => [
      { type: "rectangle" as const, label: "矩形", icon: Square },
      { type: "rounded-rectangle" as const, label: "圆角矩形", icon: RectangleHorizontal },
      { type: "diamond" as const, label: "菱形", icon: Diamond },
      { type: "ellipse" as const, label: "圆/椭圆", icon: Circle },
      { type: "text" as const, label: "文本", icon: Type },
      { type: "database" as const, label: "数据库", icon: Database },
      { type: "actor" as const, label: "参与者", icon: UserRound },
    ],
    []
  );
  const edgePresets = useMemo<EdgePreset[]>(
    () => [
      { kind: "straight-line", type: "straight", markerEnd: false, label: "直线", icon: Minus },
      { kind: "straight-arrow", type: "straight", markerEnd: true, label: "箭头", icon: ArrowRight },
      { kind: "smoothstep-arrow", type: "smoothstep", markerEnd: true, label: "折线箭头", icon: CornerDownRight },
    ],
    []
  );
  const framePresets = useMemo(
    () => [
      { type: "frame" as const, label: "容器", width: 420, height: 240, borderStyle: "solid", icon: Square },
      { type: "lane-frame" as const, label: "泳道", width: 720, height: 150, borderStyle: "solid", icon: Rows3 },
      { type: "system-frame" as const, label: "系统边界", width: 520, height: 320, borderStyle: "dashed", icon: Network },
      { type: "phase-frame" as const, label: "阶段分组", width: 360, height: 220, borderStyle: "dashed", icon: SplitSquareHorizontal },
    ],
    []
  );

  const selectedNode = currentDocument.nodes.find((node) => selectedNodeIds.includes(node.id)) ?? null;
  const selectedEdge = currentDocument.edges.find((edge) => selectedEdgeIds.includes(edge.id)) ?? null;
  const selectionCount = selectedNodeIds.length + selectedEdgeIds.length;
  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) return historyItems;
    return historyItems.filter((item) => `${item.title} ${item.prompt} ${item.templateType}`.toLowerCase().includes(query));
  }, [historyItems, historyQuery]);
  const connectionHintText = connectionTool
    ? connectionTool.stage === "select-source"
      ? `已选择「${connectionTool.preset.label}」，点击起点节点开始连接，Esc 取消。`
      : `正在从「${connectionTool.sourceLabel}」连接，点击目标节点完成，Esc 取消。`
    : "";

  useEffect(() => {
    latestDocumentRef.current = currentDocument;
  }, [currentDocument]);

  const saveHistoryDocument = useCallback(async (document: FlowchartDocument) => {
    try {
      const result = await upsertFlowchartHistory(document);
      setHistoryItems(Array.isArray(result.items) ? result.items : []);
    } catch (error) {
      console.warn("[flowchart] save history failed", error);
    }
  }, []);

  const scheduleSave = useCallback(
    (document: FlowchartDocument) => {
      const snapshot = cloneDocument(document);
      latestDocumentRef.current = snapshot;
      pendingSaveDocumentRef.current = snapshot;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        pendingSaveDocumentRef.current = null;
        void saveHistoryDocument(snapshot);
      }, 800);
    },
    [saveHistoryDocument]
  );

  useEffect(
    () => () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      const pending = pendingSaveDocumentRef.current;
      pendingSaveDocumentRef.current = null;
      if (pending) void saveHistoryDocument(pending);
    },
    [saveHistoryDocument]
  );

  const applyDocument = useCallback(
    (next: FlowchartDocument, options?: { pushUndo?: boolean; clearRedo?: boolean; save?: boolean }) => {
      const normalized = normalizeFlowchartDocument(next, currentDocument).document;
      if (options?.pushUndo) setUndoStack((stack) => [...stack.slice(-39), cloneDocument(fromGraph(currentDocument, nodes, edges))]);
      if (options?.clearRedo ?? options?.pushUndo) setRedoStack([]);
      latestDocumentRef.current = normalized;
      setCurrentDocument(normalized);
      setSelectedTemplate(normalized.templateType);
      setNodes(toGraphNodes(normalized));
      setEdges(toGraphEdges(normalized));
      setSelectedNodeIds((ids) => ids.filter((id) => normalized.nodes.some((node) => node.id === id)));
      setSelectedEdgeIds((ids) => ids.filter((id) => normalized.edges.some((edge) => edge.id === id)));
      if (options?.save ?? true) scheduleSave(normalized);
    },
    [currentDocument, edges, nodes, scheduleSave, setEdges, setNodes]
  );

  const refreshHistory = useCallback(async () => {
    try {
      const result = await listFlowchartHistory();
      setHistoryItems(Array.isArray(result.items) ? result.items : []);
    } catch (error: any) {
      showFlowchartToast({
        kind: "error",
        title: "历史加载失败",
        message: String(error?.message ?? error ?? "unknown error"),
      });
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const pushUndoSnapshot = useCallback(() => {
    setUndoStack((stack) => [...stack.slice(-39), cloneDocument(fromGraph(currentDocument, nodes, edges))]);
    setRedoStack([]);
  }, [currentDocument, edges, nodes]);

  const onNodeDragStop = useCallback(() => {
    const synced = fromGraph(currentDocument, nodes, edges);
    latestDocumentRef.current = synced;
    setCurrentDocument(synced);
    scheduleSave(synced);
  }, [currentDocument, edges, nodes, scheduleSave]);

  const createFromTemplate = (templateType: FlowchartTemplateType) => {
    applyDocument(createDefaultFlowchartDocument(templateType), { pushUndo: true });
    setAiPrompt("");
  };

  const syncCurrentGraph = () => {
    const synced = normalizeFlowchartDocument(fromGraph(currentDocument, nodes, edges), currentDocument).document;
    latestDocumentRef.current = synced;
    setCurrentDocument(synced);
    return synced;
  };

  const addShapeNode = (type: ShapeNodeType, explicitPosition?: { x: number; y: number }) => {
    const id = nowId(type);
    const label = shapePresets.find((preset) => preset.type === type)?.label ?? type;
    const nextNode: FlowchartDocNode = {
      id,
      type,
      label: type === "text" ? "" : label,
      parentId: null,
      position: explicitPosition ?? { x: 120 + (currentDocument.nodes.length % 3) * 210, y: 120 + Math.floor(currentDocument.nodes.length / 3) * 130 },
      style: {
        backgroundColor: type === "text" ? "transparent" : "color-mix(in srgb, var(--accent) 10%, var(--surface-1) 90%)",
        borderColor: type === "text" ? "transparent" : "color-mix(in srgb, var(--accent) 42%, var(--border) 58%)",
      },
    };
    const current = syncCurrentGraph();
    applyDocument({ ...current, nodes: [...current.nodes, nextNode], updatedAt: Date.now() }, { pushUndo: true });
    setSelectedNodeIds([id]);
    setSelectedEdgeIds([]);
  };

  const addFrameNode = (type: FrameNodeType, explicitPosition?: { x: number; y: number }) => {
    const preset = framePresets.find((item) => item.type === type) ?? framePresets[0];
    const id = nowId(type);
    const fallbackIndex = currentDocument.nodes.filter((node) => isFrameType(node.type)).length + 1;
    const nextNode: FlowchartDocNode = {
      id,
      type,
      label: preset.label,
      parentId: null,
      position: explicitPosition ?? { x: 80 + (fallbackIndex % 3) * 80, y: 80 + (fallbackIndex % 3) * 60 },
      style: {
        width: preset.width,
        height: preset.height,
        borderStyle: preset.borderStyle,
        backgroundColor: "color-mix(in srgb, var(--surface-2) 24%, transparent)",
        borderColor: "color-mix(in srgb, var(--accent) 42%, var(--border) 58%)",
      },
    };
    const current = syncCurrentGraph();
    applyDocument({ ...current, nodes: [nextNode, ...current.nodes], updatedAt: Date.now() }, { pushUndo: true });
    setSelectedNodeIds([id]);
    setSelectedEdgeIds([]);
  };

  const addEdgeWithPreset = (sourceId: string, targetId: string, preset: EdgePreset) => {
    if (sourceId === targetId) {
      showFlowchartToast({ kind: "warn", title: "无法连接", message: "不能连接到同一个节点。" });
      return;
    }
    const current = syncCurrentGraph();
    const source = current.nodes.find((node) => node.id === sourceId);
    const target = current.nodes.find((node) => node.id === targetId);
    if (!isConnectableNodeType(source?.type) || !isConnectableNodeType(target?.type)) {
      showFlowchartToast({ kind: "warn", title: "无法连接", message: "文本节点和框节点不能作为连接端点。" });
      return;
    }
    const edge: FlowchartEdge = {
      id: nowId(`edge-${sourceId}-${targetId}`),
      source: sourceId,
      target: targetId,
      label: "",
      type: preset.type,
      markerEnd: preset.markerEnd,
      style: { stroke: "#64748b", strokeWidth: 2 },
    };
    applyDocument({ ...current, edges: [...current.edges, edge], updatedAt: Date.now() }, { pushUndo: true });
    setSelectedEdgeIds([edge.id]);
    setSelectedNodeIds([]);
  };

  const onPaletteDragStart = (event: DragEvent, payload: PaletteDragState) => {
    event.dataTransfer.setData("application/x-codenexus-flowchart", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  };

  const onCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/x-codenexus-flowchart");
    if (!raw) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const position = {
      x: snap((event.clientX - (rect?.left ?? 0) - 100)),
      y: snap((event.clientY - (rect?.top ?? 0) - 40)),
    };
    try {
      const payload = JSON.parse(raw) as PaletteDragState;
      if (payload.kind === "shape") addShapeNode(payload.type, position);
      if (payload.kind === "frame") addFrameNode(payload.type, position);
      if (payload.kind === "edge") {
        const preset = edgePresets.find((item) => item.kind === payload.type);
        if (preset) {
          setConnectionTool({ preset, stage: "select-source", sourceId: null, sourceLabel: "" });
          showFlowchartToast({ kind: "info", title: "无法创建连线", message: "请先把连接线放到画布上，再点击起点和目标节点。" });
        }
      }
    } catch {}
  };

  const activateConnectionTool = (preset: EdgePreset) => {
    setConnectionTool({ preset, stage: "select-source", sourceId: null, sourceLabel: "" });
  };

  const onNodeClick = (_: unknown, node: ShapeNode) => {
    if (!connectionTool) {
      setSelectedNodeIds([node.id]);
      setSelectedEdgeIds([]);
      return;
    }
    const source = currentDocument.nodes.find((item) => item.id === node.id);
    if (!isConnectableNodeType(source?.type)) {
      showFlowchartToast({ kind: "warn", title: "无法连接", message: "文本节点和框节点不能作为连接端点。" });
      return;
    }
    if (connectionTool.stage === "select-source") {
      setConnectionTool({
        ...connectionTool,
        stage: "select-target",
        sourceId: node.id,
        sourceLabel: source?.label || node.id,
      });
      return;
    }
    if (connectionTool.sourceId) addEdgeWithPreset(connectionTool.sourceId, node.id, connectionTool.preset);
    setConnectionTool(null);
  };

  const onPaneClick = useCallback(() => {
    if (connectionTool) setConnectionTool(null);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, [connectionTool]);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: { nodes: ShapeNode[]; edges: ShapeEdge[] }) => {
      setSelectedNodeIds(selectedNodes.map((node) => node.id));
      setSelectedEdgeIds(selectedEdges.map((edge) => edge.id));
    },
    []
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const id = nowId(`edge-${connection.source}-${connection.target}`);
      const nextEdge: ShapeEdge = {
        ...connection,
        id,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "#64748b", strokeWidth: 2 },
      };
      pushUndoSnapshot();
      setEdges((current) => addEdge(nextEdge, current));
      const nextDocument: FlowchartDocument = {
        ...currentDocument,
        edges: [
          ...currentDocument.edges,
          { id, source: connection.source!, target: connection.target!, label: "", type: "smoothstep", markerEnd: true, style: { stroke: "#64748b", strokeWidth: 2 } },
        ],
        updatedAt: Date.now(),
      };
      latestDocumentRef.current = nextDocument;
      setCurrentDocument(nextDocument);
      scheduleSave(nextDocument);
    },
    [currentDocument, edges, nodes, pushUndoSnapshot, scheduleSave, setEdges]
  );

  const onMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => {
      const base = latestDocumentRef.current ?? currentDocument;
      const nextDocument: FlowchartDocument = {
        ...base,
        viewport: {
          x: Math.round(viewport.x),
          y: Math.round(viewport.y),
          zoom: Number(viewport.zoom.toFixed(3)),
        },
        updatedAt: Date.now(),
      };
      latestDocumentRef.current = nextDocument;
      setCurrentDocument(nextDocument);
      scheduleSave(nextDocument);
    },
    [currentDocument, scheduleSave]
  );

  const onNodesChange: OnNodesChange<ShapeNode> = useCallback(
    (changes) => setNodes((current) => applyNodeChanges(changes, current)),
    [setNodes]
  );

  const onEdgesChange: OnEdgesChange<ShapeEdge> = useCallback(
    (changes) => setEdges((current) => applyEdgeChanges(changes, current)),
    [setEdges]
  );

  const loadHistoryItem = (item: FlowchartDocument) => {
    applyDocument(item, { pushUndo: true, save: false });
  };

  const deleteHistoryItem = async (id: string) => {
    const result = await deleteFlowchartHistory(id);
    setHistoryItems(result.items);
    if (currentDocument.id === id) createFromTemplate("basic");
  };

  const undo = () => {
    setUndoStack((stack) => {
      const previous = stack.at(-1);
      if (!previous) return stack;
      setRedoStack((redo) => [...redo.slice(-39), cloneDocument(fromGraph(currentDocument, nodes, edges))]);
      applyDocument(previous, { clearRedo: false });
      return stack.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((stack) => {
      const next = stack.at(-1);
      if (!next) return stack;
      setUndoStack((undoItems) => [...undoItems.slice(-39), cloneDocument(fromGraph(currentDocument, nodes, edges))]);
      applyDocument(next, { clearRedo: false });
      return stack.slice(0, -1);
    });
  };

  const deleteSelection = () => {
    if (selectionCount === 0) return;
    const nodeIds = new Set(selectedNodeIds);
    const edgeIds = new Set(selectedEdgeIds);
    const current = syncCurrentGraph();
    applyDocument(
      {
        ...current,
        nodes: current.nodes.filter((node) => !nodeIds.has(node.id)),
        edges: current.edges.filter((edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target)),
        updatedAt: Date.now(),
      },
      { pushUndo: true }
    );
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  };

  const copySelection = () => {
    const nodeIds = new Set(selectedNodeIds);
    const current = syncCurrentGraph();
    setClipboard({
      nodes: current.nodes.filter((node) => nodeIds.has(node.id)).map((node) => ({ ...node, position: { ...node.position }, style: { ...node.style } })),
      edges: current.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)).map((edge) => ({ ...edge, style: { ...edge.style } })),
    });
  };

  const pasteSelection = () => {
    if (clipboard.nodes.length === 0) return;
    const idMap = new Map<string, string>();
    const pastedNodes = clipboard.nodes.map((node) => {
      const id = nowId(`${node.id}-copy`);
      idMap.set(node.id, id);
      return {
        ...node,
        id,
        parentId: node.parentId ? (idMap.get(node.parentId) ?? null) : null,
        position: { x: node.position.x + 40, y: node.position.y + 40 },
        style: { ...node.style },
      };
    });
    const pastedEdges = clipboard.edges
      .map((edge) => {
        const source = idMap.get(edge.source);
        const target = idMap.get(edge.target);
        if (!source || !target) return null;
        return { ...edge, id: nowId(`${edge.id}-copy`), source, target, style: { ...edge.style } };
      })
      .filter((edge): edge is FlowchartEdge => Boolean(edge));
    const current = syncCurrentGraph();
    applyDocument({ ...current, nodes: [...current.nodes, ...pastedNodes], edges: [...current.edges, ...pastedEdges], updatedAt: Date.now() }, { pushUndo: true });
    setSelectedNodeIds(pastedNodes.map((node) => node.id));
  };

  const gridLayoutTargetNodes = () => {
    const selected = new Set(selectedNodeIds);
    const selectedRegular = currentDocument.nodes.filter((node) => selected.has(node.id) && !isFrameType(node.type));
    if (selectedRegular.length > 0) return selectedRegular;
    return currentDocument.nodes.filter((node) => !isFrameType(node.type));
  };

  const layoutGrid = () => {
    const targets = gridLayoutTargetNodes();
    if (targets.length === 0) return;
    const columns = Math.max(1, Math.ceil(Math.sqrt(targets.length)));
    const targetIds = new Map(targets.map((node, index) => [node.id, { x: 80 + (index % columns) * GRID_LAYOUT_CELL.width, y: 80 + Math.floor(index / columns) * GRID_LAYOUT_CELL.height }]));
    const current = syncCurrentGraph();
    applyDocument(
      {
        ...current,
        nodes: current.nodes.map((node) => (targetIds.has(node.id) ? { ...node, parentId: null, position: targetIds.get(node.id)! } : node)),
        updatedAt: Date.now(),
      },
      { pushUndo: true }
    );
  };

  const alignSelected = (axis: "left" | "top") => {
    if (selectedNodeIds.length < 2) return;
    const current = syncCurrentGraph();
    const selected = current.nodes.filter((node) => selectedNodeIds.includes(node.id));
    const value = axis === "left" ? Math.min(...selected.map((node) => node.position.x)) : Math.min(...selected.map((node) => node.position.y));
    applyDocument(
      {
        ...current,
        nodes: current.nodes.map((node) =>
          selectedNodeIds.includes(node.id)
            ? { ...node, position: axis === "left" ? { ...node.position, x: value } : { ...node.position, y: value } }
            : node
        ),
        updatedAt: Date.now(),
      },
      { pushUndo: true }
    );
  };

  const distributeSelected = (axis: "x" | "y") => {
    if (selectedNodeIds.length < 3) return;
    const current = syncCurrentGraph();
    const sorted = current.nodes
      .filter((node) => selectedNodeIds.includes(node.id))
      .sort((a, b) => (axis === "x" ? a.position.x - b.position.x : a.position.y - b.position.y));
    const first = axis === "x" ? sorted[0].position.x : sorted[0].position.y;
    const last = axis === "x" ? sorted.at(-1)!.position.x : sorted.at(-1)!.position.y;
    const step = (last - first) / (sorted.length - 1);
    const positions = new Map(sorted.map((node, index) => [node.id, first + step * index]));
    applyDocument(
      {
        ...current,
        nodes: current.nodes.map((node) => {
          const value = positions.get(node.id);
          if (value === undefined) return node;
          return { ...node, position: axis === "x" ? { ...node.position, x: value } : { ...node.position, y: value } };
        }),
        updatedAt: Date.now(),
      },
      { pushUndo: true }
    );
  };

  const patchSelectedNode = (patch: Partial<Pick<FlowchartDocNode, "label" | "type">> & { style?: FlowchartDocNode["style"] }) => {
    if (!selectedNode) return;
    const current = syncCurrentGraph();
    applyDocument(
      {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === selectedNode.id
            ? {
                ...node,
                ...patch,
                style: patch.style ? { ...node.style, ...patch.style } : node.style,
              }
            : node
        ),
        updatedAt: Date.now(),
      },
      { pushUndo: true }
    );
  };

  const patchSelectedEdge = (patch: Partial<FlowchartEdge> & { style?: FlowchartEdge["style"] }) => {
    if (!selectedEdge) return;
    const current = syncCurrentGraph();
    applyDocument(
      {
        ...current,
        edges: current.edges.map((edge) =>
          edge.id === selectedEdge.id
            ? {
                ...edge,
                ...patch,
                type: normalizeFlowchartEdgeType(patch.type ?? edge.type),
                style: patch.style ? { ...edge.style, ...patch.style } : edge.style,
              }
            : edge
        ),
        updatedAt: Date.now(),
      },
      { pushUndo: true }
    );
  };

  const runAiAction = async (operation: "generate" | "modify") => {
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    setAiError("");
    try {
      const result = await runFlowchartAi({
        operation,
        templateType: selectedTemplate,
        prompt: aiPrompt.trim(),
        currentDocument: operation === "modify" ? syncCurrentGraph() : null,
      });
      if (!result.ok) {
        setAiError([result.errorMessage, ...result.validationErrors, result.rawResponse ?? ""].filter(Boolean).join("\n\n"));
        return;
      }
      applyDocument(result.document, { pushUndo: true });
      showFlowchartToast({
        kind: "success",
        title: "流程图已更新",
        message: result.repaired ? "AI 首次返回无效，已自动修复一次。" : "AI 已生成 JSON 图模型。",
      });
    } catch (error: any) {
      setAiError(String(error?.message ?? error));
    } finally {
      setAiBusy(false);
    }
  };

  const exportJson = () => {
    const synced = syncCurrentGraph();
    downloadText(`${synced.title || "flowchart"}.json`, `${JSON.stringify(synced, null, 2)}\n`, "application/json");
  };

  const exportSvg = async () => {
    const target = canvasRef.current?.querySelector(".react-flow") as HTMLElement | null;
    if (!target) return;
    const dataUrl = await toSvg(target, {
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--surface-1") || "#ffffff",
      filter: (node) => !(node instanceof HTMLElement && node.classList.contains("react-flow__minimap")),
    });
    const svgText = decodeURIComponent(String(dataUrl).replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
    downloadText(`${currentDocument.title || "flowchart"}.svg`, svgText, "image/svg+xml");
  };

  const onWorkbenchKeydown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    if (event.key === "Escape" && connectionTool) {
      setConnectionTool(null);
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.shiftKey ? redo() : undo();
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      redo();
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      copySelection();
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      pasteSelection();
      event.preventDefault();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      deleteSelection();
      event.preventDefault();
    }
  };

  return (
    <section
      className={["flowchart-workbench", connectionTool ? "is-connecting" : "", className].filter(Boolean).join(" ")}
      data-feature-surface="FlowchartWorkbench"
      aria-label="AI flowchart workbench"
      tabIndex={-1}
      onKeyDown={onWorkbenchKeydown}
    >
      <aside className="flowchart-panel flowchart-panel--left app-scrollbar">
        <header className="flowchart-panel-head">
          <div>
            <div className="flowchart-kicker">模板</div>
            <h2>{currentDocument.title}</h2>
          </div>
          <button className="flowchart-icon-btn" type="button" title="New diagram" onClick={() => createFromTemplate(selectedTemplate)}>
            <Plus aria-hidden="true" />
          </button>
        </header>

        <div className="flowchart-template-grid">
          {templates.map((template) => {
            const Icon = template.icon;
            return (
              <button
                key={template.type}
                className={`flowchart-template${selectedTemplate === template.type ? " is-active" : ""}`}
                type="button"
                onClick={() => createFromTemplate(template.type)}
              >
                <Icon aria-hidden="true" />
                <span>{template.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flowchart-section-head">
          <span>基础形状</span>
        </div>
        <div className="flowchart-shape-grid">
          {shapePresets.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={preset.type}
                className="flowchart-palette-item"
                type="button"
                draggable
                onClick={() => addShapeNode(preset.type)}
                onDragStart={(event) => onPaletteDragStart(event, { kind: "shape", type: preset.type })}
              >
                <Icon aria-hidden="true" />
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flowchart-section-head">
          <span>连接线</span>
        </div>
        <div className="flowchart-edge-grid">
          {edgePresets.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={preset.kind}
                className={`flowchart-palette-item${connectionTool?.preset.kind === preset.kind ? " is-active" : ""}`}
                type="button"
                draggable
                onClick={() => activateConnectionTool(preset)}
                onDragStart={(event) => onPaletteDragStart(event, { kind: "edge", type: preset.kind })}
              >
                <Icon aria-hidden="true" />
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flowchart-section-head">
          <span>预设框</span>
        </div>
        <div className="flowchart-frame-grid">
          {framePresets.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={preset.type}
                className="flowchart-palette-item"
                type="button"
                draggable
                onClick={() => addFrameNode(preset.type)}
                onDragStart={(event) => onPaletteDragStart(event, { kind: "frame", type: preset.type })}
              >
                <Icon aria-hidden="true" />
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flowchart-section-head">
          <span>历史</span>
          <button className="flowchart-text-btn" type="button" onClick={() => void refreshHistory()}>
            刷新
          </button>
        </div>
        <input
          className="flowchart-input"
          type="search"
          value={historyQuery}
          placeholder="搜索历史"
          onChange={(event) => setHistoryQuery(event.currentTarget.value)}
        />
        <div className="flowchart-history-list">
          {filteredHistory.map((item) => (
            <button
              key={item.id}
              className={`flowchart-history-item${item.id === currentDocument.id ? " is-active" : ""}`}
              type="button"
              onClick={() => loadHistoryItem(item)}
            >
              <span className="flowchart-history-title">{item.title}</span>
              <span className="flowchart-history-meta">
                {templates.find((template) => template.type === item.templateType)?.label ?? item.templateType} · {formatTime(item.updatedAt)}
              </span>
              <Trash2
                className="flowchart-history-delete"
                aria-hidden="true"
                onClick={(event) => {
                  event.stopPropagation();
                  void deleteHistoryItem(item.id);
                }}
              />
            </button>
          ))}
          {filteredHistory.length === 0 ? <div className="flowchart-empty">暂无历史</div> : null}
        </div>
      </aside>

      <main className="flowchart-canvas-shell">
        <div className="flowchart-canvas-toolbar">
          <div className="flowchart-tool-group">
            <button className="flowchart-icon-btn" type="button" title="Undo" disabled={undoStack.length === 0} onClick={undo}>
              <Undo2 aria-hidden="true" />
            </button>
            <button className="flowchart-icon-btn" type="button" title="Redo" disabled={redoStack.length === 0} onClick={redo}>
              <Redo2 aria-hidden="true" />
            </button>
          </div>
          <div className="flowchart-tool-group">
            <button className="flowchart-icon-btn" type="button" title="Copy" disabled={selectedNodeIds.length === 0} onClick={copySelection}>
              <Copy aria-hidden="true" />
            </button>
            <button className="flowchart-icon-btn" type="button" title="Paste" disabled={clipboard.nodes.length === 0} onClick={pasteSelection}>
              <ClipboardPaste aria-hidden="true" />
            </button>
            <button className="flowchart-icon-btn" type="button" title="Delete" disabled={selectionCount === 0} onClick={deleteSelection}>
              <Trash2 aria-hidden="true" />
            </button>
          </div>
          <div className="flowchart-tool-group">
            <button className="flowchart-text-btn" type="button" disabled={gridLayoutTargetNodes().length === 0} onClick={layoutGrid}>
              网格排布
            </button>
            <button className="flowchart-text-btn" type="button" disabled={selectedNodeIds.length < 2} onClick={() => alignSelected("left")}>
              左对齐
            </button>
            <button className="flowchart-text-btn" type="button" disabled={selectedNodeIds.length < 2} onClick={() => alignSelected("top")}>
              顶对齐
            </button>
            <button className="flowchart-text-btn" type="button" disabled={selectedNodeIds.length < 3} onClick={() => distributeSelected("x")}>
              横向分布
            </button>
            <button className="flowchart-text-btn" type="button" disabled={selectedNodeIds.length < 3} onClick={() => distributeSelected("y")}>
              纵向分布
            </button>
          </div>
          <div className="flowchart-canvas-status">
            {currentDocument.nodes.length} nodes · {currentDocument.edges.length} edges
          </div>
        </div>

        <div
          ref={canvasRef}
          className={`flowchart-canvas${connectionTool ? " is-connecting" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onCanvasDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            snapToGrid={snapToGrid}
            snapGrid={FLOW_SNAP_GRID}
            defaultViewport={currentDocument.viewport}
            multiSelectionKeyCode={FLOW_MULTI_SELECTION_KEY_CODES}
            selectionKeyCode={null}
            deleteKeyCode={null}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            selectNodesOnDrag={false}
            fitView
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onMoveEnd={onMoveEnd}
            onNodeDragStart={pushUndoSnapshot}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onSelectionChange={onSelectionChange}
          >
            <Background id="flowchart-grid-major" color="var(--flowchart-grid-major)" gap={100} lineWidth={0.7} />
            <Background id="flowchart-grid-minor" color="var(--flowchart-grid)" gap={20} size={1.2} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
          {connectionTool ? (
            <div className="flowchart-connect-hint" aria-live="polite">
              {connectionHintText}
            </div>
          ) : null}
          <div className="flowchart-guides" aria-hidden="true" />
        </div>
      </main>

      <aside className="flowchart-panel flowchart-panel--right app-scrollbar">
        <section className="flowchart-card">
          <header className="flowchart-section-head">
            <span>AI</span>
            <button className="flowchart-text-btn" type="button" onClick={openFlowchartSettings}>
              设置
            </button>
          </header>
          <textarea
            className="flowchart-textarea"
            value={aiPrompt}
            placeholder="描述要生成或修改的流程图，例如：用户提交报销，经理审批，财务打款。"
            disabled={aiBusy}
            onChange={(event) => setAiPrompt(event.currentTarget.value)}
          />
          <div className="flowchart-inline">
            <select className="flowchart-input" value={selectedTemplate} disabled={aiBusy} onChange={(event) => setSelectedTemplate(event.currentTarget.value as FlowchartTemplateType)}>
              {templates.map((template) => (
                <option key={template.type} value={template.type}>
                  {template.label}
                </option>
              ))}
            </select>
            <button className="flowchart-primary-btn" type="button" disabled={aiBusy || !aiPrompt.trim()} onClick={() => void runAiAction("generate")}>
              {aiBusy ? (
                <>
                  <Loader2 className="app-closing-spin" aria-hidden="true" />
                  生成中...
                </>
              ) : (
                <>
                  <Wand2 aria-hidden="true" />
                  生成
                </>
              )}
            </button>
          </div>
          <button className="flowchart-secondary-btn" type="button" disabled={aiBusy || !aiPrompt.trim()} onClick={() => void runAiAction("modify")}>
            修改当前图
          </button>
          {aiError ? <pre className="flowchart-error">{aiError}</pre> : null}
        </section>

        <section className="flowchart-card">
          <header className="flowchart-section-head">
            <span>节点属性</span>
            <span className="flowchart-muted">{selectedNodeIds.length}</span>
          </header>
          {selectedNode ? (
            <>
              <label className="flowchart-field">
                <span>标题</span>
                <input className="flowchart-input" type="text" value={selectedNode.label} onChange={(event) => patchSelectedNode({ label: event.currentTarget.value })} />
              </label>
              <label className="flowchart-field">
                <span>类型</span>
                <input className="flowchart-input" type="text" value={selectedNode.type} onChange={(event) => patchSelectedNode({ type: event.currentTarget.value })} />
              </label>
              <label className="flowchart-field">
                <span>填充</span>
                <input
                  className="flowchart-input"
                  type="color"
                  value={cssColor(selectedNode.style.backgroundColor, "#ffffff")}
                  onChange={(event) => patchSelectedNode({ style: { backgroundColor: event.currentTarget.value } })}
                />
              </label>
              <label className="flowchart-field">
                <span>边框</span>
                <input
                  className="flowchart-input"
                  type="color"
                  value={cssColor(selectedNode.style.borderColor, "#64748b")}
                  onChange={(event) => patchSelectedNode({ style: { borderColor: event.currentTarget.value } })}
                />
              </label>
              {isFrameType(selectedNode.type) ? (
                <>
                  <label className="flowchart-field">
                    <span>宽度</span>
                    <input
                      className="flowchart-input"
                      type="number"
                      min={160}
                      max={1800}
                      step={20}
                      value={nodeSize(selectedNode).width}
                      onChange={(event) => patchSelectedNode({ style: { width: Number(event.currentTarget.value) } })}
                    />
                  </label>
                  <label className="flowchart-field">
                    <span>高度</span>
                    <input
                      className="flowchart-input"
                      type="number"
                      min={100}
                      max={1200}
                      step={20}
                      value={nodeSize(selectedNode).height}
                      onChange={(event) => patchSelectedNode({ style: { height: Number(event.currentTarget.value) } })}
                    />
                  </label>
                  <label className="flowchart-field">
                    <span>边框样式</span>
                    <select
                      className="flowchart-input"
                      value={String(selectedNode.style.borderStyle ?? "solid")}
                      onChange={(event) => patchSelectedNode({ style: { borderStyle: event.currentTarget.value } })}
                    >
                      <option value="solid">实线</option>
                      <option value="dashed">虚线</option>
                    </select>
                  </label>
                </>
              ) : null}
            </>
          ) : (
            <div className="flowchart-empty">未选择节点</div>
          )}
        </section>

        <section className="flowchart-card">
          <header className="flowchart-section-head">
            <span>连线属性</span>
            <span className="flowchart-muted">{selectedEdgeIds.length}</span>
          </header>
          {selectedEdge ? (
            <>
              <label className="flowchart-field">
                <span>标题</span>
                <input className="flowchart-input" type="text" value={selectedEdge.label} onChange={(event) => patchSelectedEdge({ label: event.currentTarget.value })} />
              </label>
              <label className="flowchart-field">
                <span>线条</span>
                <input
                  className="flowchart-input"
                  type="color"
                  value={cssColor(selectedEdge.style.stroke, "#64748b")}
                  onChange={(event) => patchSelectedEdge({ style: { stroke: event.currentTarget.value } })}
                />
              </label>
              <label className="flowchart-field">
                <span>连线路径</span>
                <select className="flowchart-input" value={selectedEdge.type ?? "smoothstep"} onChange={(event) => patchSelectedEdge({ type: event.currentTarget.value as FlowchartEdgeType })}>
                  <option value="straight">直线</option>
                  <option value="smoothstep">折线</option>
                </select>
              </label>
              <label className="flowchart-switch flowchart-switch--field">
                <input type="checkbox" checked={selectedEdge.markerEnd !== false} onChange={(event) => patchSelectedEdge({ markerEnd: event.currentTarget.checked })} />
                <span>显示箭头</span>
              </label>
            </>
          ) : (
            <div className="flowchart-empty">未选择连线</div>
          )}
        </section>

        <section className="flowchart-card">
          <header className="flowchart-section-head">
            <span>导出</span>
            <label className="flowchart-switch">
              <input type="checkbox" checked={snapToGrid} onChange={(event) => setSnapToGrid(event.currentTarget.checked)} />
              <span>吸附网格</span>
            </label>
          </header>
          <button className="flowchart-secondary-btn" type="button" onClick={exportJson}>
            <Download aria-hidden="true" />
            导出 JSON
          </button>
          <button className="flowchart-secondary-btn" type="button" onClick={() => void exportSvg()}>
            <Download aria-hidden="true" />
            导出 SVG
          </button>
        </section>
        {children}
      </aside>
    </section>
  );
}
