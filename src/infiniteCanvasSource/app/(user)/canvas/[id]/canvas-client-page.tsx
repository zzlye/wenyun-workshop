// @ts-nocheck
"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Home, ImageIcon, Images, Keyboard, List, Menu, Paintbrush, Plus, Redo2, Scissors, Settings, Settings2, Trash2, Undo2, Upload, Video } from "lucide-react";
import { saveAs } from "file-saver";

import { requestEdit, requestGeneration, requestImageQuestion } from "@/services/api/image";
import { requestVideoGeneration } from "@/services/api/video";
import { defaultConfig, type AiConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { getImageBlob as getStoredCanvasImageBlob, imageToDataUrl, resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { cn } from "@/lib/utils";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { getActiveApiProfile, getApiBalanceSnapshot, setApiBalanceSnapshot, normalizeImageModelForProfile, normalizeImageSizeForProfile, normalizeSettings } from "../../../../../lib/apiProfiles";
import { copyImageSourceToClipboard, getClipboardFailureMessage } from "../../../../../lib/clipboard";
import { getImageBlobExtension, getImageSourceBlob } from "../../../../../lib/imageTransfer";
import { storeImage } from "../../../../../lib/db";
import { queryNewApiBalance } from "../../../../../lib/newApi";
import { replaceImageMentionsForApi, stripImageMentionMarkers } from "../../../../../lib/promptImageMentions";
import { primeImageCache, useStore } from "../../../../../store";
import PriceTableButton from "../../../../../components/PriceTableButton";
import { cropDataUrl, cropGridDataUrl } from "../utils/canvas-image-data";
import { isCanvasEditableTarget } from "../utils/canvas-dom-events";
import { clearCanvasGenerationSession, getCanvasGenerationSessionIds, isCanvasNodeGenerationLocked, markCanvasGenerationSession, resetInterruptedCanvasGenerations, withRunningCanvasNode, withoutRunningCanvasNodes } from "../utils/canvas-generation-running";
import { cloneNodeMetadataForDuplicate } from "../utils/canvas-node-copy";
import { fitNodeSize, nodeSizeFromRatio } from "../utils/canvas-node-size";
import { App, Button, Dropdown, Input, Modal } from "antd";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "../constants";
import { ActiveConnectionPath, ConnectionPath } from "../components/canvas-connections";
import { CanvasConfigNodePanel } from "../components/canvas-config-node-panel";
import { CanvasNodeContextMenu } from "../components/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "../components/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "../components/canvas-node-crop-dialog";
import { buildConnectedPromptText, buildNodeChatMessages, buildNodeGenerationContext, buildNodeGenerationInputs, hydrateNodeGenerationContext, mergeNodeReferenceImages, stripConnectedPromptSuffix, type NodeGenerationInput } from "../components/canvas-node-generation";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "../components/canvas-node-hover-toolbar";
import { InfiniteCanvas } from "../components/infinite-canvas";
import { Minimap } from "../components/canvas-mini-map";
import { CanvasNode } from "../components/canvas-node";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "../components/canvas-node-prompt-panel";
import { CanvasSketchDialog } from "../components/canvas-sketch-dialog";
import { CanvasToolbar } from "../components/canvas-toolbar";
import { CanvasGroupFrame } from "../components/canvas-group-frame";
import { AssetPickerModal, type AssetPickerTab, type InsertAssetPayload } from "../components/asset-picker-modal";
import { CanvasZoomControls } from "../components/canvas-zoom-controls";
import { useCanvasStore } from "../stores/use-canvas-store";
import {
    CanvasNodeType,
    type CanvasAssistantImage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasGroupData,
    type CanvasGroupLayout,
    type CanvasImageGenerationType,
    type CanvasNodeData,
    type CanvasNodeMetadata,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "../types";
import type { ReferenceImage } from "@/types/image";

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    groups?: CanvasGroupData[];
};

type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

type QuickNodeCreateMenuState = {
    position: Position;
};

type SketchDialogState = {
    position: Position;
};

type AssetCategory = "人物" | "场景" | "物品" | "风格" | "其他";

type PendingAssetSave = {
    node: CanvasNodeData;
    title: string;
    category: AssetCategory;
};

type CreatableCanvasNodeType = CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video;

type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    groups: CanvasGroupData[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
// 资产保存弹窗和资产库筛选共用这组分类，避免两个入口展示不一致。
const ASSET_CATEGORIES: AssetCategory[] = ["人物", "场景", "物品", "风格", "其他"];

function createCanvasNode(type: CanvasNodeType, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return {
        id,
        type,
        title: spec.title,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    };
}

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function CanvasRefreshShell() {
    return (
        <main className="relative h-full min-h-0 overflow-hidden bg-transparent text-foreground">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                }}
            />

            <div className="absolute bottom-5 left-1/2 z-50 flex h-14 -translate-x-1/2 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="size-8 rounded-md bg-current opacity-10" />
                ))}
            </div>

            <div className="absolute bottom-24 left-6 z-50 h-40 w-[240px] rounded-lg border shadow-2xl backdrop-blur-sm" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="absolute left-7 top-7 h-5 w-12 rounded-sm bg-current opacity-10" />
                <div className="absolute left-28 top-16 h-6 w-16 rounded-sm bg-current opacity-10" />
                <div className="absolute bottom-7 left-16 h-8 w-20 rounded-sm bg-current opacity-10" />
                <div className="absolute inset-5 rounded border border-current opacity-15" />
            </div>

            <div className="absolute bottom-5 left-5 z-50 flex h-14 w-[260px] items-center gap-2 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="h-1 flex-1 rounded-full bg-current opacity-10" />
                <div className="h-4 w-10 rounded bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
            </div>
        </main>
    );
}

function ConnectionCreateMenu({ pending, onCreate, onClose }: { pending: PendingConnectionCreate; onCreate: (type: CreatableCanvasNodeType) => void; onClose: () => void }) {
    return (
        <div
            className="absolute z-[120] w-[300px] rounded-[18px] border p-3 shadow-2xl"
            data-connection-create-menu
            style={{ left: pending.position.x, top: pending.position.y, background: "#1f1f1f", borderColor: "rgba(255,255,255,.1)", color: "#f8fafc" }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium text-white/60">
                    引用该节点生成
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label="关闭">
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption icon={<List className="size-5" />} title="文本生成" description="脚本、广告词、品牌文案" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption icon={<ImageIcon className="size-5" />} title="图片生成" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption icon={<Video className="size-5" />} title="视频生成" onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption icon={<Settings2 className="size-5" />} title="配置节点" description="模型、尺寸、数量和输入顺序" onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </div>
    );
}

function QuickNodeCreateMenu({
    menu,
    onCreate,
    onUpload,
    onOpenAssetLibrary,
    onClose,
}: {
    menu: QuickNodeCreateMenuState;
    onCreate: (type: CreatableCanvasNodeType) => void;
    onUpload: () => void;
    onOpenAssetLibrary: () => void;
    onClose: () => void;
}) {
    return (
        <div
            className="absolute z-[120] w-[300px] rounded-[18px] border p-3 shadow-2xl"
            data-canvas-node-create-menu
            style={{ left: menu.position.x, top: menu.position.y, background: "#1f1f1f", borderColor: "rgba(255,255,255,.1)", color: "#f8fafc" }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium text-white/60">
                    快速选择节点
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label="关闭">
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption icon={<List className="size-5" />} title="文本生成" description="脚本、广告词、品牌文案" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption icon={<ImageIcon className="size-5" />} title="图片生成" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption icon={<Video className="size-5" />} title="视频生成" onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption icon={<Settings2 className="size-5" />} title="配置节点" description="模型、尺寸、数量和输入顺序" onClick={() => onCreate(CanvasNodeType.Config)} />
                <ConnectionCreateOption icon={<Upload className="size-5" />} title="上传" description="图片、视频文件" onClick={onUpload} />
                <ConnectionCreateOption icon={<Images className="size-5" />} title="画布" description="从当前画布选择插入" onClick={onOpenAssetLibrary} />
            </div>
        </div>
    );
}

function ConnectionCreateOption({ icon, title, description, onClick }: { icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return (
        <button type="button" className="flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left text-white transition hover:bg-white/10" onClick={onClick}>
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10 text-white/70">
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-semibold leading-5">{title}</span>
                {description ? <span className="mt-1 block truncate text-sm text-white/45">{description}</span> : null}
            </span>
        </button>
    );
}

function InfiniteCanvasPage() {
    const { message } = App.useApp();
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const projectId = params.id;
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const assetInsertPositionRef = useRef<Position | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const didInitialCenterRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const resizeFrameRef = useRef<number | null>(null);
    const lastCanvasSizeRef = useRef({ width: 0, height: 0 });
    const toolbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        isDraggingGroup: boolean;
        groupId: string | null;
        hasMoved: boolean;
        startX: number;
        startY: number;
        initialSelectedNodes: { id: string; x: number; y: number }[];
    }>({
        isDraggingNode: false,
        isDraggingGroup: false,
        groupId: null,
        hasMoved: false,
        startX: 0,
        startY: 0,
        initialSelectedNodes: [],
    });

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const settings = useStore((state) => state.settings);
    const activeProfile = useMemo(() => getActiveApiProfile(normalizeSettings(settings)), [settings]);
    const setSettings = useStore((state) => state.setSettings);
    const setLightboxImageId = useStore((state) => state.setLightboxImageId);
    const [isPureBackground, setIsPureBackground] = useState(false);
    const [isQueryingBalance, setIsQueryingBalance] = useState(false);
    const apiBalanceText = getApiBalanceSnapshot(settings, activeProfile.id)?.text ?? "";

    const queryActiveProfileBalance = async () => {
        setIsQueryingBalance(true);
        try {
            const balance = await queryNewApiBalance(activeProfile);
            setSettings(setApiBalanceSnapshot(useStore.getState().settings, activeProfile.id, balance));
            message.success("余额已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "余额查询失败");
        } finally {
            setIsQueryingBalance(false);
        }
    };
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [groups, setGroups] = useState<CanvasGroupData[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [nodeHandlePointer, setNodeHandlePointer] = useState<{ nodeId: string; y: number } | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [quickNodeCreateMenu, setQuickNodeCreateMenu] = useState<QuickNodeCreateMenuState | null>(null);
    const [sketchDialog, setSketchDialog] = useState<SketchDialogState | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [runningNodeIds, setRunningNodeIds] = useState<Set<string>>(() => new Set());
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [interactionMode, setInteractionMode] = useState<"select" | "pan">("select");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [assetPickerTab, setAssetPickerTab] = useState<AssetPickerTab>("my-assets");
    const [pendingAssetSave, setPendingAssetSave] = useState<PendingAssetSave | null>(null);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const groupsRef = useRef(groups);
    const pageMountedRef = useRef(false);
    const runningNodeIdsRef = useRef<Set<string>>(new Set());
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const selectedGroupIdRef = useRef(selectedGroupId);
    const viewportRef = useRef(viewport);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            groups: groupsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const markCanvasNodeRunning = useCallback((nodeId: string) => {
        markCanvasGenerationSession(projectId, nodeId);
        runningNodeIdsRef.current = withRunningCanvasNode(runningNodeIdsRef.current, nodeId);
        if (pageMountedRef.current) setRunningNodeIds(new Set(runningNodeIdsRef.current));
    }, [projectId]);

    const clearCanvasNodeRunning = useCallback((nodeIds: Iterable<string>) => {
        const ids = Array.from(nodeIds);
        clearCanvasGenerationSession(projectId, ids);
        runningNodeIdsRef.current = withoutRunningCanvasNodes(runningNodeIdsRef.current, ids);
        if (pageMountedRef.current) setRunningNodeIds(new Set(runningNodeIdsRef.current));
    }, [projectId]);

    const clearAllCanvasNodeRunning = useCallback(() => {
        clearCanvasGenerationSession(projectId, runningNodeIdsRef.current);
        runningNodeIdsRef.current = new Set();
        if (pageMountedRef.current) setRunningNodeIds(new Set());
    }, [projectId]);

    const commitGenerationNodes = useCallback((updater: CanvasNodeData[] | ((prev: CanvasNodeData[]) => CanvasNodeData[])) => {
        const storeProject = useCanvasStore.getState().projects.find((project) => project.id === projectId);
        const baseNodes = storeProject?.nodes || nodesRef.current;
        const next = typeof updater === "function" ? updater(baseNodes) : updater;
        nodesRef.current = next;
        if (pageMountedRef.current) setNodes(next);
        // 后台生成可能在画布页面卸载后才完成，直接写入 store，保证返回画布时能看到结果。
        useCanvasStore.getState().updateProject(projectId, { nodes: next });
    }, [projectId]);

    const commitGenerationConnections = useCallback((updater: CanvasConnection[] | ((prev: CanvasConnection[]) => CanvasConnection[])) => {
        const storeProject = useCanvasStore.getState().projects.find((project) => project.id === projectId);
        const baseConnections = storeProject?.connections || connectionsRef.current;
        const next = typeof updater === "function" ? updater(baseConnections) : updater;
        connectionsRef.current = next;
        if (pageMountedRef.current) setConnections(next);
        useCanvasStore.getState().updateProject(projectId, { connections: next });
    }, [projectId]);

    useEffect(() => {
        pageMountedRef.current = true;
        return () => {
            pageMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        setProjectLoaded(false);
        const project = openProject(projectId);
        if (!project) {
            router.replace("/canvas");
            return;
        }

        const restore = async () => {
            const activeGenerationIds = getCanvasGenerationSessionIds(projectId);
            const restoredNodes = await hydrateCanvasImages(resetInterruptedCanvasGenerations(project.nodes, activeGenerationIds));
            const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);
            setNodes(restoredNodes);
            runningNodeIdsRef.current = activeGenerationIds;
            setRunningNodeIds(new Set(activeGenerationIds));
            setConnections(project.connections);
            setGroups(project.groups || []);
            setChatSessions(restoredSessions);
            setActiveChatId(project.activeChatId || null);
            setBackgroundMode(project.backgroundMode);
            setShowImageInfo(project.showImageInfo || false);
            setViewport(project.viewport);
            // 只有默认视口才交给首次布局居中，避免覆盖用户已保存的画布位置。
            didInitialCenterRef.current = !(project.viewport.x === 0 && project.viewport.y === 0 && project.viewport.k === 1);
            historyRef.current = { past: [], future: [] };
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = {
                nodes: restoredNodes,
                connections: project.connections,
                groups: project.groups || [],
                chatSessions: restoredSessions,
                activeChatId: project.activeChatId || null,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo || false,
            };
            setHistoryState({ canUndo: false, canRedo: false });
            setProjectLoaded(true);
        };
        void restore();
    }, [hydrated, openProject, projectId, router]);

    useEffect(() => {
        if (!projectLoaded) return;
        return useCanvasStore.subscribe((state, previousState) => {
            const project = state.projects.find((item) => item.id === projectId);
            const previousProject = previousState.projects.find((item) => item.id === projectId);
            if (!project) return;

            const activeGenerationIds = getCanvasGenerationSessionIds(projectId);
            runningNodeIdsRef.current = activeGenerationIds;
            setRunningNodeIds(new Set(activeGenerationIds));
            const hasGenerationActivity = activeGenerationIds.size > 0 || project.nodes.some((node) => node.metadata?.status === NODE_STATUS_LOADING) || nodesRef.current.some((node) => node.metadata?.status === NODE_STATUS_LOADING);
            if (!hasGenerationActivity) return;

            const shouldSyncGenerationNodes = project.nodes !== previousProject?.nodes && project.nodes !== nodesRef.current && project.nodes.some((node) => {
                const current = nodesRef.current.find((item) => item.id === node.id);
                return activeGenerationIds.has(node.id) || current?.metadata?.status === NODE_STATUS_LOADING || node.metadata?.status === NODE_STATUS_LOADING;
            });
            if (shouldSyncGenerationNodes) {
                void hydrateCanvasImages(project.nodes).then((hydratedNodes) => {
                    nodesRef.current = hydratedNodes;
                    setNodes(hydratedNodes);
                });
            }

            if (project.connections !== previousProject?.connections && project.connections !== connectionsRef.current) {
                connectionsRef.current = project.connections;
                setConnections(project.connections);
            }
        });
    }, [projectId, projectLoaded]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (previous?.nodes === next.nodes && previous.connections === next.connections && previous.groups === next.groups && previous.chatSessions === next.chatSessions && previous.activeChatId === next.activeChatId && previous.backgroundMode === next.backgroundMode && previous.showImageInfo === next.showImageInfo) return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, groups, nodes, projectLoaded, showImageInfo]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updateProject(projectId, { nodes, connections, groups, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, groups, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useEffect(() => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, updateProject, viewport]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        groupsRef.current = groups;
        runningNodeIdsRef.current = runningNodeIds;
        selectedNodeIdsRef.current = selectedNodeIds;
        selectedGroupIdRef.current = selectedGroupId;
        viewportRef.current = viewport;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [nodes, connections, groups, runningNodeIds, selectedNodeIds, selectedGroupId, viewport, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    useEffect(() => {
        if (!projectLoaded) return;

        const el = containerRef.current;
        if (!el) return;

        // 画布容器尺寸只跟随窗口变化，不再监听容器自身，避免和视口更新互相触发。
        const commitSize = () => {
            resizeFrameRef.current = null;
            const rect = el.getBoundingClientRect();
            const nextSize = {
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            };

            if (nextSize.width <= 0 || nextSize.height <= 0) return;

            const previous = lastCanvasSizeRef.current;
            if (previous.width !== nextSize.width || previous.height !== nextSize.height) {
                lastCanvasSizeRef.current = nextSize;
                setSize((current) =>
                    current.width === nextSize.width && current.height === nextSize.height ? current : nextSize,
                );
            }

            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                setViewport((current) =>
                    current.x === nextSize.width / 2 && current.y === nextSize.height / 2 && current.k === 1
                        ? current
                        : { x: nextSize.width / 2, y: nextSize.height / 2, k: 1 },
                );
            }
        };

        const scheduleSizeUpdate = () => {
            if (resizeFrameRef.current !== null) return;
            resizeFrameRef.current = window.requestAnimationFrame(commitSize);
        };

        scheduleSizeUpdate();
        window.addEventListener("resize", scheduleSizeUpdate);
        window.visualViewport?.addEventListener("resize", scheduleSizeUpdate);

        return () => {
            window.removeEventListener("resize", scheduleSizeUpdate);
            window.visualViewport?.removeEventListener("resize", scheduleSizeUpdate);
            if (resizeFrameRef.current !== null) {
                window.cancelAnimationFrame(resizeFrameRef.current);
                resizeFrameRef.current = null;
            }
        };
    }, [projectLoaded]);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) setNodeHandlePointer(null);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen) return;
            if (toolbarHideTimerRef.current) {
                clearTimeout(toolbarHideTimerRef.current);
                toolbarHideTimerRef.current = null;
            }
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const closeNodeToolbarImmediately = useCallback(() => {
        if (toolbarHideTimerRef.current) {
            clearTimeout(toolbarHideTimerRef.current);
            toolbarHideTimerRef.current = null;
        }
        setHoveredNodeId(null);
        setToolbarNodeId(null);
    }, []);

    const hideNodeToolbar = useCallback(() => {
        if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
        toolbarHideTimerRef.current = setTimeout(() => {
            setToolbarNodeId(null);
            toolbarHideTimerRef.current = null;
        }, 120);
    }, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            const { fromNodeId, toNodeId } = connection;
            const exists = connectionsRef.current.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId);
            if (!exists) {
                setConnections((prev) => [...prev, { id: `conn-${Date.now()}`, fromNodeId, toNodeId }]);
            }
            setContextMenu(null);
        },
        [message],
    );

    const createConnectedNode = useCallback(
        (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video, pending: PendingConnectionCreate) => {
            const metadata = type === CanvasNodeType.Config ? { model: effectiveConfig.imageModel || effectiveConfig.model, size: effectiveConfig.size, count: 1 } : undefined;
            const newNode = createCanvasNode(type, pending.position, metadata);
            const connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, { id: nanoid(), ...connection }]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedGroupId(null);
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, setConnecting],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const getConnectableNodeAtPoint = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle) => {
            const world = screenToCanvas(clientX, clientY);
            const hitPadding = 56 / Math.max(viewportRef.current.k, 0.35);
            const target = [...nodesRef.current]
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .reverse()
                .find((node) => {
                    if (node.id === current.nodeId) return false;
                    if (!normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType)) return false;
                    const left = node.position.x - hitPadding;
                    const right = node.position.x + node.width + hitPadding;
                    const top = node.position.y - hitPadding;
                    const bottom = node.position.y + node.height + hitPadding;
                    if (world.x < left || world.x > right || world.y < top || world.y > bottom) return false;

                    // 靠近目标节点左右边缘时优先吸附，节点间距很近时也能稳定选中。
                    const nearLeftHandle = Math.abs(world.x - node.position.x) <= hitPadding;
                    const nearRightHandle = Math.abs(world.x - (node.position.x + node.width)) <= hitPadding;
                    const insideNode = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                    return insideNode || nearLeftHandle || nearRightHandle;
                });
            if (target) {
                setNodeHandlePointer({
                    nodeId: target.id,
                    y: ((world.y - target.position.y) / Math.max(target.height, 1)) * 100,
                });
                return target.id;
            }
            setNodeHandlePointer(null);
            return null;
        },
        [screenToCanvas],
    );

    const visibleNodes = useMemo(() => {
        const padding = 280;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || size.width;
        const height = rect?.height || size.height;
        const viewLeft = -viewport.x / viewport.k - padding;
        const viewTop = -viewport.y / viewport.k - padding;
        const viewRight = viewLeft + width / viewport.k + padding * 2;
        const viewBottom = viewTop + height / viewport.k + padding * 2;

        return nodes.filter((node) => !isHiddenBatchChild(node, nodes, collapsingBatchIds) && node.position.x + node.width > viewLeft && node.position.x < viewRight && node.position.y + node.height > viewTop && node.position.y < viewBottom);
    }, [collapsingBatchIds, nodes, size.height, size.width, viewport.k, viewport.x, viewport.y]);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const selectedConnectionActionPosition = useMemo(() => {
        if (!selectedConnectionId) return null;
        const connection = connections.find((item) => item.id === selectedConnectionId);
        if (!connection) return null;
        const from = nodeById.get(connection.fromNodeId);
        const to = nodeById.get(connection.toNodeId);
        if (!from || !to || isHiddenBatchConnectionEndpoint(from, nodes) || isHiddenBatchConnectionEndpoint(to, nodes)) return null;

        const startX = from.position.x + from.width;
        const startY = from.position.y + from.height / 2;
        const endX = to.position.x;
        const endY = to.position.y + to.height / 2;
        const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
        return cubicPoint(
            { x: startX, y: startY },
            { x: startX + curvature, y: startY },
            { x: endX - curvature, y: endY },
            { x: endX, y: endY },
            0.5,
        );
    }, [connections, nodeById, nodes, selectedConnectionId]);
    const toolbarNode = toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const contextNode = contextMenu?.type === "node" ? nodeById.get(contextMenu.nodeId) || null : null;
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const batchChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            if (node.metadata?.isBatchRoot) map.set(node.id, node.metadata.batchChildIds?.length || 0);
        });
        return map;
    }, [nodes]);
    const batchMotionById = useMemo(() => {
        const map = new Map<string, { x: number; y: number; index: number }>();
        nodes.forEach((node) => {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) return;
            const root = nodeById.get(rootId);
            const index = root?.metadata?.batchChildIds?.indexOf(node.id) ?? 0;
            const stackX = root ? root.position.x + 34 + index * 14 : node.position.x;
            const stackY = root ? root.position.y + 14 + index * 8 : node.position.y;
            map.set(node.id, { x: stackX - node.position.x, y: stackY - node.position.y, index: Math.max(index, 0) });
        });
        return map;
    }, [nodeById, nodes]);
    const groupBoundsById = useMemo(() => {
        const map = new Map<string, { x: number; y: number; width: number; height: number }>();
        groups.forEach((group) => {
            const groupNodes = group.nodeIds.map((id) => nodeById.get(id)).filter((node): node is CanvasNodeData => Boolean(node));
            if (!groupNodes.length) return;
            const padding = group.padding ?? 42;
            const left = Math.min(...groupNodes.map((node) => node.position.x)) - padding;
            const top = Math.min(...groupNodes.map((node) => node.position.y)) - padding;
            const right = Math.max(...groupNodes.map((node) => node.position.x + node.width)) + padding;
            const bottom = Math.max(...groupNodes.map((node) => node.position.y + node.height)) + padding;
            map.set(group.id, { x: left, y: top, width: right - left, height: bottom - top });
        });
        return map;
    }, [groups, nodeById]);
    const selectedGroupFromNodes = useMemo(() => {
        if (selectedGroupId || !selectedNodeIds.size) return null;
        const selectedIds = Array.from(selectedNodeIds)
            .map((id) => nodeById.get(id))
            .filter((node): node is CanvasNodeData => Boolean(node && !isHiddenBatchChild(node, nodes)))
            .map((node) => node.id)
            .sort();
        if (!selectedIds.length) return null;
        const exactGroup = groups.find((group) => group.nodeIds.length === selectedIds.length && [...group.nodeIds].sort().every((nodeId, index) => nodeId === selectedIds[index]));
        return exactGroup || groups.find((group) => selectedIds.every((nodeId) => group.nodeIds.includes(nodeId))) || null;
    }, [groups, nodeById, nodes, selectedGroupId, selectedNodeIds]);
    const selectedGroup = selectedGroupId ? groups.find((group) => group.id === selectedGroupId) || null : selectedGroupFromNodes;
    const selectedGroupBounds = selectedGroup ? groupBoundsById.get(selectedGroup.id) || null : null;
    const selectedNodesBounds = useMemo(() => {
        if (selectedGroup || selectedNodeIds.size < 2) return null;
        const selectedNodes = Array.from(selectedNodeIds)
            .map((id) => nodeById.get(id))
            .filter((node): node is CanvasNodeData => Boolean(node && !isHiddenBatchChild(node, nodes)));
        if (selectedNodes.length < 2) return null;
        const padding = 24;
        const left = Math.min(...selectedNodes.map((node) => node.position.x)) - padding;
        const top = Math.min(...selectedNodes.map((node) => node.position.y)) - padding;
        const right = Math.max(...selectedNodes.map((node) => node.position.x + node.width)) + padding;
        const bottom = Math.max(...selectedNodes.map((node) => node.position.y + node.height)) + padding;
        return { x: left, y: top, width: right - left, height: bottom - top };
    }, [nodeById, nodes, selectedGroup, selectedNodeIds]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        nodeIds.add(activeNodeId);
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            nodeIds.add(connection.fromNodeId);
            nodeIds.add(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.Config) return;
            map.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections));
        });
        return map;
    }, [connections, nodes]);

    const createNode = useCallback(
        (type: CanvasNodeType, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          count: 1,
                      }
                    : undefined;
            const newNode = createCanvasNode(type, targetPosition, configMetadata);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedGroupId(null);
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text) setDialogNodeId(newNode.id);
        },
        [effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter],
    );

    const openSketchDialog = useCallback(
        (position?: Position) => {
            setSketchDialog({ position: position || getCanvasCenter() });
            setContextMenu(null);
            setQuickNodeCreateMenu(null);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [getCanvasCenter, setConnecting],
    );

    const saveSketchToCanvas = useCallback(
        async (dataUrl: string) => {
            try {
                const image = await uploadImage(dataUrl);
                const size = fitNodeSize(image.width, image.height);
                const position = sketchDialog?.position || getCanvasCenter();
                const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const newNode: CanvasNodeData = {
                    id,
                    type: CanvasNodeType.Image,
                    title: "画笔参考图",
                    position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                    width: size.width,
                    height: size.height,
                    metadata: imageMetadata(image),
                };

                setNodes((prev) => [...prev, newNode]);
                setSelectedNodeIds(new Set([id]));
                setSelectedGroupId(null);
                setSelectedConnectionId(null);
                setDialogNodeId(id);
                setSketchDialog(null);
                message.success("画笔参考图已添加到画布");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "保存画笔参考图失败");
            }
        },
        [getCanvasCenter, message, sketchDialog?.position],
    );

    const handleCanvasDoubleClick = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            const position = screenToCanvas(event.clientX, event.clientY);
            setQuickNodeCreateMenu({ position });
            setContextMenu(null);
            setPendingConnectionCreate(null);
            setConnecting(null);
            setSelectedNodeIds(new Set());
            setSelectedGroupId(null);
            setSelectedConnectionId(null);
            setSelectionBox(null);
        },
        [screenToCanvas, setConnecting],
    );

    const createQuickNode = useCallback(
        (type: CreatableCanvasNodeType) => {
            if (!quickNodeCreateMenu) return;
            createNode(type, quickNodeCreateMenu.position);
            setQuickNodeCreateMenu(null);
        },
        [createNode, quickNodeCreateMenu],
    );

    const openAssetLibraryFromQuickMenu = useCallback(() => {
        if (!quickNodeCreateMenu) return;
        assetInsertPositionRef.current = quickNodeCreateMenu.position;
        setAssetPickerTab("canvas");
        setAssetPickerOpen(true);
        setQuickNodeCreateMenu(null);
    }, [quickNodeCreateMenu]);

    const createGroupFromSelection = useCallback(() => {
        const nodeIds = Array.from(selectedNodeIdsRef.current).filter((id) => nodesRef.current.some((node) => node.id === id && !isHiddenBatchChild(node, nodesRef.current)));
        if (nodeIds.length < 2) {
            message.warning("至少选择两个节点才能打组");
            return;
        }
        const id = nanoid();
        const group: CanvasGroupData = {
            id,
            title: "分组",
            nodeIds,
            color: "#2f80ff",
            layout: "free",
            padding: 42,
        };
        const groupedIds = new Set(nodeIds);
        setGroups((prev) => [...prev.map((item) => ({ ...item, nodeIds: item.nodeIds.filter((nodeId) => !groupedIds.has(nodeId)) })).filter((item) => item.nodeIds.length > 1), group]);
        setSelectedGroupId(id);
        setSelectedConnectionId(null);
        setContextMenu(null);
    }, [message]);

    const renameGroup = useCallback((groupId: string, title: string) => {
        setGroups((prev) => prev.map((group) => (group.id === groupId ? { ...group, title: title.trim() || group.title } : group)));
    }, []);

    const changeGroupColor = useCallback((groupId: string, color: string) => {
        setGroups((prev) => prev.map((group) => (group.id === groupId ? { ...group, color } : group)));
    }, []);

    const ungroupNodes = useCallback((groupId: string) => {
        setGroups((prev) => prev.filter((group) => group.id !== groupId));
        setSelectedGroupId(null);
    }, []);

    const applyGroupLayout = useCallback((groupId: string, layout: CanvasGroupLayout) => {
        const group = groupsRef.current.find((item) => item.id === groupId);
        if (!group) return;
        const groupNodes = group.nodeIds.map((id) => nodesRef.current.find((node) => node.id === id)).filter((node): node is CanvasNodeData => Boolean(node));
        if (!groupNodes.length) return;
        setGroups((prev) => prev.map((item) => (item.id === groupId ? { ...item, layout } : item)));
        if (layout === "free") return;

        const gap = 36;
        const minLeft = Math.min(...groupNodes.map((node) => node.position.x));
        const minTop = Math.min(...groupNodes.map((node) => node.position.y));
        const sortedNodes = [...groupNodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
        const nextPositionById = new Map<string, Position>();

        if (layout === "horizontal") {
            let x = minLeft;
            sortedNodes.forEach((node) => {
                nextPositionById.set(node.id, { x, y: minTop });
                x += node.width + gap;
            });
        } else if (layout === "vertical") {
            let y = minTop;
            sortedNodes.forEach((node) => {
                nextPositionById.set(node.id, { x: minLeft, y });
                y += node.height + gap;
            });
        } else {
            const columns = Math.ceil(Math.sqrt(sortedNodes.length));
            const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(...sortedNodes.filter((_, index) => index % columns === column).map((node) => node.width), 0));
            const rowHeights = Array.from({ length: Math.ceil(sortedNodes.length / columns) }, (_, row) => Math.max(...sortedNodes.slice(row * columns, row * columns + columns).map((node) => node.height), 0));
            sortedNodes.forEach((node, index) => {
                const column = index % columns;
                const row = Math.floor(index / columns);
                const x = minLeft + columnWidths.slice(0, column).reduce((sum, value) => sum + value + gap, 0);
                const y = minTop + rowHeights.slice(0, row).reduce((sum, value) => sum + value + gap, 0);
                nextPositionById.set(node.id, { x, y });
            });
        }

        setNodes((prev) => prev.map((node) => (nextPositionById.has(node.id) ? { ...node, position: nextPositionById.get(node.id)! } : node)));
    }, []);

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            nodesRef.current.forEach((node) => {
                if (ids.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => allIds.add(childId));
            });
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const childIds = node.metadata?.batchChildIds?.filter((childId) => !allIds.has(childId));
                    if (!node.metadata?.isBatchRoot || childIds?.length === node.metadata.batchChildIds?.length) return node;
                    const primaryImageId = childIds?.includes(node.metadata.primaryImageId || "") ? node.metadata.primaryImageId : childIds?.[0];
                    const primaryNode = next.find((item) => item.id === primaryImageId);
                    return {
                        ...node,
                        metadata: {
                            ...node.metadata,
                            batchChildIds: childIds,
                            primaryImageId,
                            content: primaryNode?.metadata?.content || node.metadata.content,
                            naturalWidth: primaryNode?.metadata?.naturalWidth || node.metadata.naturalWidth,
                            naturalHeight: primaryNode?.metadata?.naturalHeight || node.metadata.naturalHeight,
                        },
                    };
                });
            });
            setGroups((prev) => prev.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => !allIds.has(id)) })).filter((group) => group.nodeIds.length > 1));
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedGroupId(null);
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setEditingNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            clearCanvasNodeRunning(allIds);
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, clearCanvasNodeRunning, projectId],
    );

    const deleteConnection = useCallback((connectionId: string) => {
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
    }, []);

    const deleteSelectedConnection = useCallback(() => {
        if (!selectedConnectionId) return;
        deleteConnection(selectedConnectionId);
    }, [deleteConnection, selectedConnectionId]);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setQuickNodeCreateMenu(null);
        setSelectedNodeIds(new Set());
        setSelectedGroupId(null);
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        setGroups([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        clearAllCanvasNodeRunning();
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [clearAllCanvasNodeRunning, cleanupCanvasFiles, deselectCanvas, projectId]);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;

        const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const next: CanvasNodeData = {
            ...source,
            id,
            title: `${source.title} Copy`,
            position: { x: source.position.x + 36, y: source.position.y + 36 },
            metadata: cloneNodeMetadataForDuplicate(source.metadata),
        };

        setNodes((prev) => [...prev, next]);
        setConnections((prev) => prev.filter((connection) => connection.fromNodeId !== id && connection.toNodeId !== id));
        setSelectedNodeIds(new Set([id]));
        setSelectedGroupId(null);
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: cloneNodeMetadataForDuplicate(node.metadata),
            }));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
    }, []);

    const pasteCopiedNodes = useCallback((position?: Position) => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = position || getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
                metadata: cloneNodeMetadataForDuplicate(node.metadata),
            };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            if (!fromNodeId || !toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...nextNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(nextNodes.map((node) => node.id)));
        setSelectedGroupId(null);
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(nextNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter]);

    const copyAllNodes = useCallback(() => {
        const allIds = new Set(nodesRef.current.map((node) => node.id));
        if (!allIds.size) return;
        clipboardRef.current = {
            nodes: nodesRef.current.map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: cloneNodeMetadataForDuplicate(node.metadata),
            })),
            connections: connectionsRef.current.map((connection) => ({ ...connection })),
        };
    }, []);

    const copySingleNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;
        clipboardRef.current = {
            nodes: [
                {
                    ...source,
                    position: { ...source.position },
                    metadata: cloneNodeMetadataForDuplicate(source.metadata),
                },
            ],
            connections: [],
        };
    }, []);

    const resetViewport = useCallback(() => {
        setViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [size.height, size.width]);

    const setZoomScale = useCallback(
        (scale: number) => {
            const nextScale = Math.min(Math.max(scale, 0.05), 5);
            setViewport((prev) => ({
                x: size.width / 2 - ((size.width / 2 - prev.x) / prev.k) * nextScale,
                y: size.height / 2 - ((size.height / 2 - prev.y) / prev.k) * nextScale,
                k: nextScale,
            }));
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        setNodes(entry.nodes);
        setConnections(entry.connections);
        setGroups(entry.groups || []);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedGroupId(null);
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory]);

    const createAndOpenProject = useCallback(() => {
        const id = createProject(`画布工坊 ${useCanvasStore.getState().projects.length + 1}`);
        router.push(`/canvas/${id}`);
    }, [createProject, router]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        router.push("/canvas");
    }, [cleanupAssetImages, deleteProjects, projectId, router]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setQuickNodeCreateMenu(null);
            setContextMenu(null);
            setSelectedGroupId(null);
            setDialogNodeId(null);
            setEditingNodeId(null);
            setNodeImageSettingsOpen(false);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
                setSelectedGroupId(null);
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        setContextMenu(null);
        closeNodeToolbarImmediately();

        // 右键只负责打开菜单，不能进入左键点击后的节点编辑和拖拽流程。
        if (event.button !== 0) return;

        setSelectedGroupId(null);
        setSelectedConnectionId(null);

        const currentSelected = selectedNodeIdsRef.current;
        const currentNodes = nodesRef.current;
        const containingGroup = !(event.shiftKey || event.metaKey || event.ctrlKey) ? groupsRef.current.find((group) => group.nodeIds.includes(nodeId)) : null;
        if (containingGroup) {
            const dragIds = new Set(containingGroup.nodeIds);
            setSelectedGroupId(containingGroup.id);
            setSelectedNodeIds(new Set(containingGroup.nodeIds));
            dragRef.current = {
                isDraggingNode: true,
                isDraggingGroup: true,
                groupId: containingGroup.id,
                hasMoved: false,
                startX: event.clientX,
                startY: event.clientY,
                initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
            };
            historyPausedRef.current = true;
            nodeDraggingRef.current = true;
            setIsNodeDragging(true);
            return;
        }
        const nextSelected = new Set(currentSelected);

        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) {
                nextSelected.delete(nodeId);
            } else {
                nextSelected.add(nodeId);
            }
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }

        setSelectedNodeIds(nextSelected);
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (nextSelected.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => dragIds.add(childId));
        });
        dragRef.current = {
            isDraggingNode: true,
            isDraggingGroup: false,
            groupId: null,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
        };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, [closeNodeToolbarImmediately]);

    const handleGroupMouseDown = useCallback((event: ReactMouseEvent, groupId: string) => {
        event.stopPropagation();
        event.preventDefault();
        if (event.button !== 0) return;
        const group = groupsRef.current.find((item) => item.id === groupId);
        if (!group) return;
        const dragIds = new Set(group.nodeIds);
        setSelectedGroupId(groupId);
        setSelectedNodeIds(new Set(group.nodeIds));
        setSelectedConnectionId(null);
        setContextMenu(null);
        closeNodeToolbarImmediately();
        dragRef.current = {
            isDraggingNode: true,
            isDraggingGroup: true,
            groupId,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes: nodesRef.current.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
        };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, [closeNodeToolbarImmediately]);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasGroupClick = dragRef.current.isDraggingGroup && !dragRef.current.hasMoved;
        const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.length === 1 && !dragRef.current.isDraggingGroup;
        const clickedGroupId = dragRef.current.groupId;
        const clickedNodeId = dragRef.current.initialSelectedNodes[0]?.id;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            setNodes((prev) =>
                prev.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    if (!initial) return node;
                    return { ...node, position: { x: initial.x + dx, y: initial.y + dy } };
                }),
            );
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.isDraggingGroup = false;
        dragRef.current.groupId = null;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        if (wasGroupClick && clickedGroupId) {
            setSelectedGroupId(clickedGroupId);
        }
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            if (clickedNode?.type === CanvasNodeType.Text) {
                setDialogNodeId(clickedNodeId);
            } else {
                setDialogNodeId(clickedNodeId);
            }
        }
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            const currentViewport = viewportRef.current;

            if (dragRef.current.isDraggingNode) {
                const dx = (event.clientX - dragRef.current.startX) / currentViewport.k;
                const dy = (event.clientY - dragRef.current.startY) / currentViewport.k;
                const initialPositions = dragRef.current.initialSelectedNodes;
                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    dragRef.current.hasMoved = true;
                }

                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(() => {
                    setNodes((prev) =>
                        prev.map((node) => {
                            const initial = initialPositions.find((item) => item.id === node.id);
                            return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                        }),
                    );
                    rafRef.current = null;
                });
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const targetNodeId = getConnectableNodeAtPoint(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = targetNodeId;
                setConnectionTargetNodeId(targetNodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [finishNodeDrag, getConnectableNodeAtPoint, screenToCanvas],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .forEach((node) => {
                    const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

                    if (intersects) nextSelected.add(node.id);
                });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [screenToCanvas],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);

            selectionBoxRef.current = null;
            setSelectionBox(null);

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const targetNodeId = getConnectableNodeAtPoint(event.clientX, event.clientY, currentConnection) || connectionTargetNodeIdRef.current;
                if (targetNodeId) {
                    connectNodes(currentConnection, targetNodeId);
                    setConnecting(null);
                } else {
                    setNodeHandlePointer(null);
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setPendingConnectionCreate({ connection: currentConnection, position: screenToCanvas(event.clientX, event.clientY) });
                }
            }
        },
        [connectNodes, finishNodeDrag, getConnectableNodeAtPoint, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => finishNodeDrag(event.clientX, event.clientY);
        const cancelNodeDrag = () => finishNodeDrag();
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const image = await uploadImage(file);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: imageMetadata(image),
        };

        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds(new Set([id]));
        setSelectedGroupId(null);
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadMediaFile(file, "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedGroupId(null);
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createTextNodeFromClipboard = useCallback(
        (text: string, position?: Position) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, position || getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || "剪切板文本",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedGroupId(null);
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (isCanvasEditableTarget(event.target)) return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedGroupId(null);
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedGroupIdRef.current && !selectedNodeIdsRef.current.size) {
                    ungroupNodes(selectedGroupIdRef.current);
                } else if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteSelectedConnection();
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedGroupId(null);
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setEditingNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setSketchDialog(null);
                setPendingConnectionCreate(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteNodes, deleteSelectedConnection, redoCanvas, selectedConnectionId, setConnecting, undoCanvas]);

    useEffect(() => {
        const handlePaste = (event: ClipboardEvent) => {
            if (isCanvasEditableTarget(event.target)) return;
            // 画布粘贴优先使用系统剪切板的图片和文字，没有内容时再走画布内部复制的节点。
            const imageItem = Array.from(event.clipboardData?.items || []).find((item) => item.type.startsWith("image/"));
            if (imageItem) {
                event.preventDefault();
                const file = imageItem.getAsFile();
                if (file) {
                    void createImageFileNode(file, mouseWorld);
                    message.success("已从剪切板添加图片");
                }
                return;
            }

            const text = event.clipboardData?.getData("text/plain") || "";
            if (text.trim()) {
                event.preventDefault();
                if (createTextNodeFromClipboard(text, mouseWorld)) message.success("已从剪切板添加文本");
                return;
            }

            if (clipboardRef.current?.nodes.length) {
                event.preventDefault();
                pasteCopiedNodes(mouseWorld);
            }
        };

        window.addEventListener("paste", handlePaste);
        return () => window.removeEventListener("paste", handlePaste);
    }, [createImageFileNode, createTextNodeFromClipboard, message, mouseWorld, pasteCopiedNodes]);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setNodeHandlePointer(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, width, height, position: position || node.position, metadata: { ...node.metadata, manualSize: true } } : node)));
    }, []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content } } : node)));
    }, []);

    const renameCanvasNode = useCallback((nodeId: string, title: string) => {
        const nextTitle = title.trim();
        if (!nextTitle) return;
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, title: nextTitle, metadata: { ...node.metadata, manualTitle: true } } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        const isExpanded = Boolean(nodesRef.current.find((node) => node.id === nodeId)?.metadata?.imageBatchExpanded);
        if (isExpanded) {
            setCollapsingBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setCollapsingBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 320);
        } else {
            setOpeningBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setOpeningBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 260);
        }
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                return { ...node, metadata: { ...node.metadata, imageBatchExpanded: !node.metadata?.imageBatchExpanded } };
            }),
        );
    }, []);

    const setBatchPrimary = useCallback((child: CanvasNodeData) => {
        const rootId = child.metadata?.batchRootId;
        if (!rootId || !child.metadata?.content) return;
        setNodes((prev) =>
            prev.map((node) =>
                node.id === rootId
                    ? {
                          ...node,
                          width: child.width,
                          height: child.height,
                          metadata: {
                              ...node.metadata,
                              content: child.metadata?.content,
                              primaryImageId: child.id,
                              naturalWidth: child.metadata?.naturalWidth,
                              naturalHeight: child.metadata?.naturalHeight,
                              freeResize: child.metadata?.freeResize,
                          },
                      }
                    : node,
            ),
        );
    }, []);

    const openTextEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedGroupId(null);
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

    const downloadNodeImage = useCallback(async (node: CanvasNodeData) => {
        if ((node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video) || !node.metadata?.content) return;
        if (node.type === CanvasNodeType.Video) {
            saveAs(node.metadata.content, `canvas-${node.type}-${node.id}.mp4`);
            return;
        }

        try {
            const storedBlob = node.metadata.storageKey ? await getStoredCanvasImageBlob(node.metadata.storageKey) : null;
            const blob = storedBlob || (await getImageSourceBlob(node.metadata.content));
            saveAs(blob, `canvas-${node.type}-${node.id}.${getImageBlobExtension(blob, node.metadata.content)}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载图片失败");
        }
    }, [message]);

    const copyNodeImage = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return;
            try {
                await copyImageSourceToClipboard(node.metadata.content);
                message.success("图片已复制");
            } catch (error) {
                message.error(getClipboardFailureMessage("复制图片失败", error));
            }
        },
        [message],
    );

    const openNodeLightbox = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return;
            try {
                const dataUrl = await imageToDataUrl({ url: node.metadata.content, storageKey: node.metadata.storageKey });
                if (!dataUrl) throw new Error("图片不存在");
                const imageId = await storeImage(dataUrl, "generated");
                primeImageCache(imageId, dataUrl);
                setLightboxImageId(imageId, [imageId]);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "打开图片失败");
            }
        },
        [message, setLightboxImageId],
    );

    const getDefaultAssetTitle = useCallback((node: CanvasNodeData) => {
        const sourceTitle = node.title || node.metadata?.prompt || node.metadata?.content || "";
        const trimmed = sourceTitle.trim();
        if (trimmed) return trimmed.slice(0, 32);
        if (node.type === CanvasNodeType.Text) return "画布文本";
        if (node.type === CanvasNodeType.Video) return "画布视频";
        return "画布图片";
    }, []);

    const saveNodeAsset = useCallback(
        (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text && !node.metadata?.content?.trim()) return message.error("没有可保存的文本");
            if (node.type === CanvasNodeType.Video && !node.metadata?.content) return message.error("没有可保存的视频");
            if (node.type === CanvasNodeType.Image && !node.metadata?.content) return message.error("没有可保存的图片");
            if (node.type !== CanvasNodeType.Text && node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video) return message.error("当前节点不能保存为素材");

            const category = ASSET_CATEGORIES.includes(node.metadata?.assetCategory as AssetCategory) ? (node.metadata?.assetCategory as AssetCategory) : "其他";
            setPendingAssetSave({ node, title: getDefaultAssetTitle(node), category });
        },
        [getDefaultAssetTitle, message],
    );

    const confirmSaveNodeAsset = useCallback(() => {
        if (!pendingAssetSave) return;
        const node = pendingAssetSave.node;
        const title = pendingAssetSave.title.trim() || getDefaultAssetTitle(node);
        const category = pendingAssetSave.category;

        if (node.type === CanvasNodeType.Text) {
            const content = node.metadata?.content?.trim();
            if (!content) return message.error("没有可保存的文本");
            addAsset({ kind: "text", title, coverUrl: "", tags: [category], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id, category } });
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, assetCategory: category } } : item)));
            setPendingAssetSave(null);
            message.success("已加入我的素材");
            return;
        }
        if (node.type === CanvasNodeType.Video) {
            if (!node.metadata?.content) return message.error("没有可保存的视频");
            addAsset({
                kind: "video",
                title,
                coverUrl: "",
                tags: [category],
                source: "Canvas",
                data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt, category },
            });
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, assetCategory: category } } : item)));
            setPendingAssetSave(null);
            message.success("已加入我的素材");
            return;
        }
        if (!node.metadata?.content) return message.error("没有可保存的图片");
        const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
        addAsset({
            kind: "image",
            title,
            coverUrl: node.metadata.content,
            tags: [category],
            source: "Canvas",
            data: {
                dataUrl,
                storageKey: node.metadata.storageKey,
                width: node.metadata.naturalWidth || node.width,
                height: node.metadata.naturalHeight || node.height,
                bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                mimeType: node.metadata.mimeType || "image/png",
            },
            metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt, category },
        });
        setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, assetCategory: category } } : item)));
        setPendingAssetSave(null);
        message.success("已加入我的素材");
    }, [addAsset, getDefaultAssetTitle, message, pendingAssetSave]);

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadImage(cropped);
        const width = Math.min(node.width, Math.max(220, image.width));
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Cropped Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width,
            height: width * (image.height / image.width),
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setSelectedGroupId(null);
        setDialogNodeId(childId);
        setCropNodeId(null);
    }, []);

    const cropImageNodeGrid = useCallback(
        async (node: CanvasNodeData, rows: number, cols: number) => {
            if (!node.metadata?.content) return;
            const safeRows = clampGridCropSize(rows);
            const safeCols = clampGridCropSize(cols);
            const cells = await cropGridDataUrl(node.metadata.content, safeRows, safeCols);
            const uploaded = await Promise.all(cells.map(async (cell) => ({ ...cell, image: await uploadImage(cell.dataUrl) })));
            const firstImage = uploaded[0]?.image;
            const maxWidth = Math.min(220, Math.max(120, node.width / Math.max(1, safeCols)));
            const cellSize = firstImage ? fitNodeSize(firstImage.width, firstImage.height, maxWidth, maxWidth) : { width: maxWidth, height: maxWidth };
            const childNodes = uploaded.map(({ row, col, image }) => {
                const id = nanoid();
                return {
                    id,
                    type: CanvasNodeType.Image,
                    title: `${safeRows}x${safeCols} 宫格 ${row + 1}-${col + 1}`,
                    position: {
                        x: node.position.x + node.width + 96 + col * (cellSize.width + 24),
                        y: node.position.y + row * (cellSize.height + 24),
                    },
                    width: cellSize.width,
                    height: cellSize.height,
                    metadata: {
                        ...imageMetadata(image),
                        prompt: node.metadata?.prompt,
                        generationPrompt: node.metadata?.generationPrompt,
                    },
                } satisfies CanvasNodeData;
            });
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedGroupId(null);
            setSelectedConnectionId(null);
            setDialogNodeId(childNodes[0]?.id || null);
            message.success(`已裁剪为 ${safeRows * safeCols} 张图片`);
        },
        [message],
    );

    const cropImageNodeCustomGrid = useCallback(
        (node: CanvasNodeData) => {
            const value = window.prompt("输入宫格行列，例如 3x4", "3x3");
            if (!value) return;
            const match = value.trim().match(/^(\d+)\s*(?:x|\*|,|，|:|：|\s)\s*(\d+)$/i);
            if (!match) {
                message.error("请输入类似 3x4 的行列格式");
                return;
            }
            void cropImageNodeGrid(node, Number(match[1]), Number(match[2]));
        },
        [cropImageNodeGrid, message],
    );

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image", activeProfile.id), count: "1" };
            if (!isCanvasGenerationConfigReady(generationConfig, "image", isAiConfigReady)) {
                openConfigDialog(true);
                return;
            }
            const childId = nanoid();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [
                { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey },
            ], prompt);
            setAngleNodeId(null);
            markCanvasNodeRunning(childId);
            commitGenerationNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageConfig.width,
                    height: imageConfig.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            commitGenerationConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedGroupId(null);
            setDialogNodeId(childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }]).then(
                    (items) => items[0],
                );
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                commitGenerationNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, ...getGeneratedMediaSizePatch(item, size), metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                commitGenerationNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                clearCanvasNodeRunning([childId]);
            }
        },
        [activeProfile.id, clearCanvasNodeRunning, commitGenerationConnections, commitGenerationNodes, effectiveConfig, markCanvasNodeRunning, openConfigDialog],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const uploadFromQuickMenu = useCallback(() => {
        if (!quickNodeCreateMenu) return;
        handleUploadRequest(undefined, quickNodeCreateMenu.position);
        setQuickNodeCreateMenu(null);
    }, [handleUploadRequest, quickNodeCreateMenu]);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            const target = uploadTargetRef.current;
            if (!file || (!file.type.startsWith("image/") && !file.type.startsWith("video/"))) return;

            if (target?.nodeId) {
                if (file.type.startsWith("video/")) {
                    const video = await uploadMediaFile(file, "video");
                    const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) => prev.map((node) => (node.id === target.nodeId ? { ...node, type: CanvasNodeType.Video, title: file.name, position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 }, width: nextSize.width, height: nextSize.height, metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined } } : node)));
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedGroupId(null);
                    setSelectedConnectionId(null);
                    setDialogNodeId(target.nodeId);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                const image = await uploadImage(file);
                const size = fitNodeSize(image.width, image.height);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === target.nodeId
                            ? {
                                  ...node,
                                  type: CanvasNodeType.Image,
                                  title: file.name,
                                  width: size.width,
                                  height: size.height,
                                  metadata: {
                                      ...node.metadata,
                                      ...imageMetadata(image),
                                      errorDetails: undefined,
                                      freeResize: false,
                                      isBatchRoot: undefined,
                                      batchRootId: undefined,
                                      batchChildIds: undefined,
                                      batchUsesReferenceImages: undefined,
                                      generationType: undefined,
                                      model: undefined,
                                      size: undefined,
                                      quality: undefined,
                                      count: undefined,
                                      references: undefined,
                                      primaryImageId: undefined,
                                      imageBatchExpanded: undefined,
                                  },
                              }
                            : node,
                    ),
                );
                setSelectedNodeIds(new Set([target.nodeId]));
                setSelectedGroupId(null);
                setSelectedConnectionId(null);
                setDialogNodeId(target.nodeId);
            } else {
                const position = target?.position || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                void (file.type.startsWith("video/") ? createVideoFileNode(file, position) : createImageFileNode(file, position));
            }

            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [createImageFileNode, createVideoFileNode, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/") || item.type.startsWith("video/"));
            if (!file) return;

            const pos = screenToCanvas(event.clientX, event.clientY);
            void (file.type.startsWith("video/") ? createVideoFileNode(file, pos) : createImageFileNode(file, pos));
        },
        [createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const pasteAssistantImage = useCallback(
        (file: File) => {
            const position = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            void createImageFileNode(file, position);
            message.success("已从剪切板添加图片");
        },
        [createImageFileNode, message, screenToCanvas, size.height, size.width],
    );

    const handleAssistantSessionsChange = useCallback((sessions: CanvasAssistantSession[], activeId: string | null) => {
        setChatSessions(sessions);
        setActiveChatId(activeId);
    }, []);

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || "未命名画布");
        setTitleEditing(true);
    }, [currentProject?.title]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-node-id],[data-connection-create-menu],[data-canvas-node-create-menu],[data-canvas-no-zoom]")) return;
        event.preventDefault();
        setQuickNodeCreateMenu(null);
        setSelectedNodeIds(new Set());
        setSelectedGroupId(null);
        setSelectedConnectionId(null);
        setContextMenu({ type: "canvas", x: event.clientX, y: event.clientY, position: screenToCanvas(event.clientX, event.clientY) });
    }, [screenToCanvas]);

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            if (isCanvasNodeGenerationLocked(sourceNode, runningNodeIdsRef.current)) return;
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode, activeProfile.id);
            if (!isCanvasGenerationConfigReady(generationConfig, mode, isAiConfigReady)) {
                openConfigDialog(true);
                return;
            }

            const generationStartedAt = Date.now();
            const timing = () => buildGenerationTiming(generationStartedAt);
            markCanvasNodeRunning(nodeId);
            let pendingChildIds: string[] = [];
            let markSourceStatus = false;
            if (sourceNode?.type === CanvasNodeType.Image && mode === "image") {
                commitGenerationNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: prompt.trim(), status: NODE_STATUS_LOADING, errorDetails: undefined, generationStartedAt, generationElapsedMs: undefined } } : node)));
            }

            try {
                const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
                const editingTextNode = mode === "text" && Boolean(sourceTextContent);
                const manualReferenceImages = await hydrateManualReferenceImages(sourceNode?.metadata?.referenceImages);
                const connectedReferencePreview = buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, "");
                const promptReferenceCount = mergeNodeReferenceImages(manualReferenceImages, connectedReferencePreview.referenceImages).length;
                const promptForApi = formatCanvasPromptForApi(prompt, promptReferenceCount);
                const baseGenerationContext = await hydrateNodeGenerationContext(
                    buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${promptForApi}` : promptForApi),
                );
                const generationContext = withMergedReferenceImages(baseGenerationContext, manualReferenceImages);
                const sourcePrompt = prompt.trim();
                const effectivePrompt = generationContext.prompt.trim();
                markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
                if (!effectivePrompt && mode === "text") {
                    return;
                }
                if (markSourceStatus) commitGenerationNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt, status: NODE_STATUS_LOADING, errorDetails: undefined, generationStartedAt, generationElapsedMs: undefined } } : node)));

                if (mode === "image") {
                    const count = getGenerationCount(generationConfig.count);
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const referenceImages = mergeNodeReferenceImages(generationContext.referenceImages);
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages, effectivePrompt);
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const gap = 96;
                    const rowGap = 36;
                    const rootId = isImageNode ? nodeId : nanoid();
                    const childIds = count > 1 ? Array.from({ length: count }, () => nanoid()) : [];
                    const targetIds = count > 1 ? childIds : [rootId];
                    pendingChildIds = isImageNode ? childIds : [rootId, ...childIds];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: sourcePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: isImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + gap,
                            y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: isImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
                        height: isImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
                        metadata: {
                            content: undefined,
                            storageKey: undefined,
                            naturalWidth: undefined,
                            naturalHeight: undefined,
                            bytes: undefined,
                            mimeType: undefined,
                            prompt: sourcePrompt,
                            status: NODE_STATUS_LOADING,
                            errorDetails: undefined,
                            generationStartedAt,
                            generationElapsedMs: undefined,
                            primaryImageId: undefined,
                            isBatchRoot: count > 1,
                            batchChildIds: count > 1 ? childIds : undefined,
                            batchUsesReferenceImages: referenceImages.length > 0,
                            ...generationMetadata,
                            imageBatchExpanded: count > 1 ? true : undefined,
                        },
                    };
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Image,
                        title: sourcePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageConfig.width + 36),
                            y: rootNode.position.y + Math.floor(index / 2) * (imageConfig.height + rowGap),
                        },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: { prompt: sourcePrompt, status: NODE_STATUS_LOADING, generationStartedAt, batchRootId: count > 1 ? rootId : undefined, ...generationMetadata },
                    }));
                    const batchConnections = [...(isImageNode ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]), ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];
                    pendingChildIds.forEach(markCanvasNodeRunning);

                    commitGenerationNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isConfigNode
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, prompt, status: NODE_STATUS_LOADING, errorDetails: undefined, generationStartedAt, generationElapsedMs: undefined },
                                      }
                                    : isImageNode
                                      ? {
                                            ...node,
                                            position: rootNode.position,
                                            width: rootNode.width,
                                            height: rootNode.height,
                                            title: getGeneratedNodeTitle(node, rootNode.title),
                                            metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined },
                                        }
                                      : {
                                            ...node,
                                            type: CanvasNodeType.Text,
                                            title: getGeneratedNodeTitle(node, prompt.slice(0, 32) || "Prompt"),
                                            width: parentConfig.width,
                                            height: parentConfig.height,
                                            metadata: { ...node.metadata, content: stripImageMentionMarkers(prompt), prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                                        }
                                : node,
                        ),
                        ...(isImageNode ? [] : [rootNode]),
                        ...childNodes,
                    ]);
                    commitGenerationConnections((prev) => [...prev, ...batchConnections]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedGroupId(null);
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    let hasSuccess = false;
                    let hasFailure = false;
                    await Promise.all(
                        targetIds.map(async (targetId) => {
                            try {
                                const image = referenceImages.length
                                    ? await requestEdit({ ...generationConfig, count: "1" }, effectivePrompt, referenceImages).then((items) => items[0])
                                    : await requestGeneration({ ...generationConfig, count: "1" }, effectivePrompt).then((items) => items[0]);
                                const uploaded = await uploadImage(image.dataUrl);
                                const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                                commitGenerationNodes((prev) => {
                                    const root = prev.find((node) => node.id === rootId);
                                    return prev.map((node) => {
                                        if (node.id !== targetId && node.id !== rootId) return node;
                                        if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId))
                                            return {
                                                ...node,
                                                ...getGeneratedMediaSizePatch(node, imageSize),
                                                metadata: { ...node.metadata, ...imageMetadata(uploaded), primaryImageId: targetId, ...timing() },
                                            };
                                        if (node.id === targetId)
                                            return {
                                                ...node,
                                                ...getGeneratedMediaSizePatch(node, imageSize),
                                                metadata: { ...node.metadata, ...imageMetadata(uploaded), ...timing() },
                                            };
                                        return node;
                                    });
                                });
                                hasSuccess = true;
                                if (isConfigNode) commitGenerationNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined, ...timing() } } : node)));
                                return true;
                            } catch (error) {
                                const errorDetails = error instanceof Error ? error.message : "生成失败";
                                hasFailure = true;
                                commitGenerationNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails, ...timing() } } : node)));
                                return false;
                            }
                        }),
                    );
                    if (hasFailure) message.error(hasSuccess ? "部分图片生成失败" : "全部图片生成失败");
                    commitGenerationNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isConfigNode
                                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "全部图片生成失败", ...timing() } }
                                : node.id === nodeId && isImageNode
                                  ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "全部图片生成失败", ...timing() } }
                                  : node.id === rootId && !hasSuccess
                                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails: "全部图片生成失败", ...timing() } }
                                    : node,
                        ),
                    );
                    return;
                }

                if (mode === "video") {
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const videoId = isEmptyVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isEmptyVideoNode ? sourceNode.width : spec.width,
                        height: isEmptyVideoNode ? sourceNode.height : spec.height,
                        metadata: { prompt: sourcePrompt, generationPrompt: effectivePrompt, status: NODE_STATUS_LOADING, generationStartedAt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, references: generationContext.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)) },
                    };
                    pendingChildIds = [videoId];
                    if (videoId !== nodeId) markCanvasNodeRunning(videoId);
                    commitGenerationNodes((prev) =>
                        isEmptyVideoNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode, title: getGeneratedNodeTitle(node, videoNode.title), metadata: { ...node.metadata, ...videoNode.metadata } } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode],
                    );
                    if (!isEmptyVideoNode) commitGenerationConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const video = await uploadMediaFile(await requestVideoGeneration(generationConfig, effectivePrompt, generationContext.referenceImages), "video");
                    const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    commitGenerationNodes((prev) => prev.map((node) => (node.id === videoId ? { ...node, ...getGeneratedMediaSizePatch(node, videoSize), metadata: { ...node.metadata, ...videoMetadata(video), prompt: sourcePrompt, generationPrompt: effectivePrompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, references: generationContext.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)), ...timing() } } : node)));
                    return;
                }

                let streamed = "";
                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = isConfigNode ? getGenerationCount(generationConfig.count) : 1;
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const childIds = isConfigNode || editingTextNode ? Array.from({ length: textCount }, () => nanoid()) : [];
                pendingChildIds = childIds;
                pendingChildIds.forEach(markCanvasNodeRunning);
                if (isConfigNode || editingTextNode) {
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Text,
                        title: prompt.slice(0, 32) || "Generated Text",
                        position: {
                            x: parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (textCount - 1) / 2) * (textConfig.height + 36),
                        },
                        width: textConfig.width,
                        height: textConfig.height,
                        metadata: { prompt, status: NODE_STATUS_LOADING, fontSize: 14, generationStartedAt },
                    }));
                    commitGenerationNodes((prev) => [...prev.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, prompt, status: NODE_STATUS_LOADING, errorDetails: undefined, generationStartedAt, generationElapsedMs: undefined } } : node)), ...childNodes]);
                    commitGenerationConnections((prev) => [...prev, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
                }

                const answers = await Promise.all(
                    (childIds.length ? childIds : [nodeId]).map((targetNodeId) => {
                        let localStreamed = "";
                        return requestImageQuestion(generationConfig, buildNodeChatMessages({ ...generationContext, prompt: effectivePrompt }), (text) => {
                            localStreamed = text;
                            streamed = text;
                            if (isConfigNode) return;
                            commitGenerationNodes((prev) => prev.map((node) => (node.id === targetNodeId ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: text, status: NODE_STATUS_LOADING } } : node)));
                        }).then((answer) => ({ nodeId: targetNodeId, content: answer || localStreamed }));
                    }),
                );
                const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                commitGenerationNodes((prev) =>
                    prev.map((node) =>
                        childIds.includes(node.id)
                            ? { ...node, metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS, ...timing() } }
                            : node.id === nodeId && isConfigNode
                              ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, ...timing() } }
                              : node.id === nodeId && !editingTextNode
                                ? { ...node, type: CanvasNodeType.Text, title: getGeneratedNodeTitle(node, stripImageMentionMarkers(prompt).slice(0, 32) || "Generated Text"), metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS, ...timing() } }
                                : node,
                    ),
                );
            } catch (error) {
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                commitGenerationNodes((prev) =>
                    prev.map((node) => {
                        const isSourceNode = node.id === nodeId;
                        if (!isSourceNode && !pendingChildIds.includes(node.id)) return node;
                        if (isSourceNode && !markSourceStatus && sourceNode?.type !== CanvasNodeType.Image) return node;
                        return { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails, ...timing() } };
                    }),
                );
            } finally {
                clearCanvasNodeRunning([nodeId, ...pendingChildIds]);
            }
        },
        [activeProfile.id, clearCanvasNodeRunning, commitGenerationConnections, commitGenerationNodes, effectiveConfig, markCanvasNodeRunning, openConfigDialog],
    );

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData) => {
            if (isCanvasNodeGenerationLocked(node, runningNodeIdsRef.current)) return;
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const batchRoot = node.metadata?.batchRootId ? nodesRef.current.find((item) => item.id === node.metadata?.batchRootId) : null;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? { ...batchRoot?.metadata, ...node.metadata } : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const savedImageModel = savedImageMetadata ? normalizeImageModelForProfile(savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model, activeProfile.id) : "";
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageModel,
                          imageModel: savedImageModel,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: normalizeImageSizeForProfile(savedImageMetadata.size || effectiveConfig.size, activeProfile.id),
                          count: "1",
                    }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : "image", activeProfile.id), count: "1" };
            const generationMode = node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : "image";
            if (!isCanvasGenerationConfigReady(generationConfig, generationMode, isAiConfigReady)) {
                openConfigDialog(true);
                return;
            }

            const sourcePrompt = getNodeOwnPrompt(sourceNode, node, nodesRef.current, connectionsRef.current);
            const shouldRebuildRetryContext = !hasSavedImageMetadata || !savedImageMetadata?.generationPrompt;
            const context = shouldRebuildRetryContext ? await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, sourcePrompt)) : null;
            const requestPrompt = (savedImageMetadata?.generationPrompt || context?.prompt || sourcePrompt).trim();
            if (!requestPrompt) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error("参考图片已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
                return;
            }

            const generationStartedAt = Date.now();
            const timing = () => buildGenerationTiming(generationStartedAt);
            markCanvasNodeRunning(node.id);
            commitGenerationNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined, generationStartedAt, generationElapsedMs: undefined } } : item)));

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(generationConfig, buildNodeChatMessages({ ...context, prompt: requestPrompt }), (text) => {
                        streamed = text;
                        commitGenerationNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                    });
                    commitGenerationNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt: sourcePrompt, generationPrompt: requestPrompt, status: NODE_STATUS_SUCCESS, ...timing() } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    const video = await uploadMediaFile(await requestVideoGeneration(generationConfig, requestPrompt, retryReferenceImages || []), "video");
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    commitGenerationNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, ...getGeneratedMediaSizePatch(item, videoSize), metadata: { ...item.metadata, ...videoMetadata(video), prompt: sourcePrompt, generationPrompt: requestPrompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, ...timing() } } : item)));
                    return;
                }

                const image = useReferenceImages ? await requestEdit(generationConfig, requestPrompt, retryReferenceImages).then((items) => items[0]) : await requestGeneration(generationConfig, requestPrompt).then((items) => items[0]);
                const uploadedImage = await uploadImage(image.dataUrl);
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const imageSize = fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                const generationMetadata = savedImageMetadata?.generationType
                    ? { generationType: savedImageMetadata.generationType, model: generationConfig.model, size: generationConfig.size, quality: generationConfig.quality, count: savedImageMetadata.count || 1, references: savedImageMetadata.references }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryReferenceImages || [], requestPrompt);
                commitGenerationNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  type: CanvasNodeType.Image,
                                  ...getGeneratedMediaSizePatch(item, imageSize),
                                  metadata: { ...item.metadata, ...imageMetadata(uploadedImage), prompt: sourcePrompt, generationPrompt: requestPrompt, ...generationMetadata, ...timing() },
                              }
                            : item,
                    ),
                );
            } catch (error) {
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                commitGenerationNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, ...timing() } } : item)));
            } finally {
                clearCanvasNodeRunning([node.id]);
            }
        },
        [activeProfile.id, clearCanvasNodeRunning, commitGenerationNodes, effectiveConfig, markCanvasNodeRunning, message, openConfigDialog],
    );

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning("文本节点为空，无法生图");
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: 1,
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedGroupId(null);
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message],
    );

    const executeGroup = useCallback(
        (groupId: string) => {
            const group = groupsRef.current.find((item) => item.id === groupId);
            if (!group) return;
            const groupNodes = group.nodeIds.map((id) => nodesRef.current.find((node) => node.id === id)).filter((node): node is CanvasNodeData => Boolean(node));
            const executableNodes = groupNodes.filter((node) => node.type === CanvasNodeType.Config || node.type === CanvasNodeType.Text || node.metadata?.status === "error");
            if (!executableNodes.length) {
                message.info("组内没有可执行节点");
                return;
            }
            executableNodes.forEach((node, index) => {
                window.setTimeout(() => {
                    if (node.metadata?.status === "error") {
                        void handleRetryNode(node);
                        return;
                    }
                    if (node.type === CanvasNodeType.Text) {
                        void generateImageFromTextNode(node);
                        return;
                    }
                    void handleGenerateNode(node.id, node.metadata?.generationMode || "image", node.metadata?.prompt || "");
                }, index * 180);
            });
        },
        [generateImageFromTextNode, handleGenerateNode, handleRetryNode, message],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage, position?: Position) => {
            const storedImage = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadImage(image.dataUrl);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitNodeSize(meta.width, meta.height);
            const center = position || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedGroupId(null);
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [screenToCanvas, size.height, size.width],
    );

    const insertAssistantText = useCallback(
        (text: string, position?: Position) => {
            const center = position || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedGroupId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            const insertPosition = assetInsertPositionRef.current || undefined;
            if (payload.kind === "text") {
                insertAssistantText(payload.content, insertPosition);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = insertPosition || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => [...prev, { id, type: CanvasNodeType.Video, title: payload.title, position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 }, width: nextSize.width, height: nextSize.height, metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height } }]);
                setSelectedNodeIds(new Set([id]));
                setSelectedGroupId(null);
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey }, insertPosition);
            }
            assetInsertPositionRef.current = null;
            setAssetPickerOpen(false);
        },
        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],
    );

    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: "transparent", color: theme.node.text }}>
            <section className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentProject?.title || "未命名画布"}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onHome={() => router.push("/canvas")}
                    onProjects={() => router.push("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onOpenSettings={() => router.openSettings()}
                    isPureBackground={isPureBackground}
                    onTogglePureBackground={() => setIsPureBackground(!isPureBackground)}
                    apiBalanceText={apiBalanceText}
                    activeProfile={activeProfile}
                    onQueryBalance={queryActiveProfileBalance}
                    isQueryingBalance={isQueryingBalance}
                />

                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    backgroundMode={backgroundMode}
                    isPureBackground={isPureBackground}
                    interactionMode={interactionMode}
                    onViewportChange={(next) => {
                        setViewport(next);
                        setQuickNodeCreateMenu(null);
                        setContextMenu(null);
                    }}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDoubleClick={handleCanvasDoubleClick}
                    onCanvasDeselect={deselectCanvas}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        {connections
                            .filter((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                return Boolean(from && to && !isHiddenBatchConnectionEndpoint(from, nodes) && !isHiddenBatchConnectionEndpoint(to, nodes));
                            })
                            .map((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                if (!from || !to) return null;

                                return (
                                    <ConnectionPath
                                        key={connection.id}
                                        connection={connection}
                                        from={from}
                                        to={to}
                                        active={selectedConnectionId === connection.id || relatedHighlight.connectionIds.has(connection.id)}
                                        onSelect={() => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setSelectedGroupId(null);
                                            setContextMenu(null);
                                        }}
                                    />
                                );
                            })}
                        {connectingParams ? <ActiveConnectionPath node={nodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} /> : null}
                    </svg>

                    {selectedConnectionActionPosition ? (
                        <button
                            type="button"
                            data-no-drag-select
                            data-canvas-no-zoom
                            className="absolute z-[65] grid h-9 w-9 cursor-pointer place-items-center rounded-full border shadow-lg backdrop-blur-md transition hover:scale-105"
                            style={{
                                left: selectedConnectionActionPosition.x,
                                top: selectedConnectionActionPosition.y,
                                transform: "translate(-50%, -50%)",
                                background: `${theme.toolbar.panel}e6`,
                                borderColor: `${theme.toolbar.border}cc`,
                                color: theme.node.activeStroke,
                            }}
                            aria-label="删除连线"
                            title="删除连线"
                            onMouseDown={(event) => {
                                event.stopPropagation();
                                event.preventDefault();
                            }}
                            onPointerDown={(event) => {
                                event.stopPropagation();
                                event.preventDefault();
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                deleteSelectedConnection();
                            }}
                        >
                            <Scissors className="size-4 stroke-[2.4]" />
                        </button>
                    ) : null}

                    {groups.map((groupItem) => {
                        const bounds = groupBoundsById.get(groupItem.id);
                        if (!bounds) return null;
                        return (
                            <CanvasGroupFrame
                                key={groupItem.id}
                                group={groupItem}
                                bounds={bounds}
                                selected={selectedGroupId === groupItem.id}
                                onSelect={(groupId) => {
                                    const group = groupsRef.current.find((item) => item.id === groupId);
                                    setSelectedGroupId(groupId);
                                    setSelectedNodeIds(new Set(group?.nodeIds || []));
                                    setSelectedConnectionId(null);
                                    setContextMenu(null);
                                }}
                                onDragStart={handleGroupMouseDown}
                                onRename={renameGroup}
                            />
                        );
                    })}

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id}
                            isConnecting={Boolean(connectingParams)}
                            handlePointerY={nodeHandlePointer?.nodeId === node.id ? nodeHandlePointer.y : null}
                            editRequestNonce={editingNodeId === node.id ? editRequestNonce : 0}
                            showPanel={dialogNodeId === node.id && !selectionBox}
                            batchCount={batchChildCountById.get(node.id) || 0}
                            batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                            batchClosing={Boolean(node.metadata?.batchRootId && collapsingBatchIds.has(node.metadata.batchRootId))}
                            batchOpening={openingBatchIds.has(node.id)}
                            batchRecovering={collapsingBatchIds.has(node.id)}
                            batchMotion={batchMotionById.get(node.id)}
                            showImageInfo={showImageInfo}
                            renderPanel={(panelNode) => (
                                <CanvasNodePromptPanel
                                    node={panelNode}
                                    canvasNodes={nodes}
                                    inputs={buildNodeGenerationInputs(panelNode.id, nodes, connections)}
                                    isRunning={isCanvasNodeGenerationLocked(panelNode, runningNodeIds)}
                                    onPromptChange={handleNodePromptChange}
                                    onConfigChange={handleConfigNodeChange}
                                    onGenerate={handleGenerateNode}
                                    onImageSettingsOpenChange={(open) => {
                                        setNodeImageSettingsOpen(open);
                                        if (open) setToolbarNodeId(null);
                                    }}
                                />
                            )}
                            renderNodeContent={(contentNode) => (
                                <CanvasConfigNodePanel
                                    node={contentNode}
                                    isRunning={isCanvasNodeGenerationLocked(contentNode, runningNodeIds)}
                                    inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                                    inputs={configInputsById.get(contentNode.id) || []}
                                    onConfigChange={handleConfigNodeChange}
                                    onTextInputChange={handleNodeContentChange}
                                    onGenerate={(nodeId) => {
                                        const target = nodesRef.current.find((item) => item.id === nodeId);
                                        void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.prompt || "");
                                    }}
                                />
                            )}
                            onMouseDown={handleNodeMouseDown}
                            onHoverStart={(nodeId) => {
                                if (nodeDraggingRef.current) return;
                                setHoveredNodeId(nodeId);
                                keepNodeToolbar(nodeId);
                            }}
                            onHoverEnd={(nodeId) => {
                                setHoveredNodeId((current) => (current === nodeId ? null : current));
                                hideNodeToolbar();
                            }}
                            onConnectStart={handleConnectStart}
                            onResize={handleNodeResize}
                            onContentChange={handleNodeContentChange}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onRetry={(node) => void handleRetryNode(node)}
                            onGenerateImage={generateImageFromTextNode}
                            onUpload={handleUploadRequest}
                            onRename={renameCanvasNode}
                            onContextMenu={(event, id) => {
                                const target = event.target;
                                if (target instanceof Element && target.closest("[data-connection-handle]")) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setContextMenu(null);
                                    return;
                                }
                                event.preventDefault();
                                event.stopPropagation();
                                closeNodeToolbarImmediately();
                                setContextMenu({ type: "node", x: event.clientX, y: event.clientY, position: screenToCanvas(event.clientX, event.clientY), nodeId: id });
                            }}
                        />
                    ))}

                    {selectionBox ? (
                        <div
                            className="pointer-events-none absolute z-[100] border"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                                borderColor: theme.canvas.selectionStroke,
                                background: theme.canvas.selectionFill,
                            }}
                        />
                    ) : null}
                    {pendingConnectionCreate ? <ConnectionCreateMenu pending={pendingConnectionCreate} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}
                    {quickNodeCreateMenu ? <QuickNodeCreateMenu menu={quickNodeCreateMenu} onCreate={createQuickNode} onUpload={uploadFromQuickMenu} onOpenAssetLibrary={openAssetLibraryFromQuickMenu} onClose={() => setQuickNodeCreateMenu(null)} /> : null}
                    {contextMenu ? (
                        <CanvasNodeContextMenu
                            menu={contextMenu}
                            scale={viewport.k}
                            canUndo={historyState.canUndo}
                            canRedo={historyState.canRedo}
                            canPaste={Boolean(clipboardRef.current?.nodes.length)}
                            isImageNode={contextNode?.type === CanvasNodeType.Image}
                            hasNodeContent={Boolean(contextNode && (contextNode.type === CanvasNodeType.Text ? contextNode.metadata?.content?.trim() : contextNode.metadata?.content))}
                            onClose={() => setContextMenu(null)}
                            onDuplicate={() => {
                                if (contextMenu.type !== "node") return;
                                duplicateNode(contextMenu.nodeId);
                                setContextMenu(null);
                            }}
                            onDelete={() => {
                                if (contextMenu.type !== "node") return;
                                deleteNodes(new Set([contextMenu.nodeId]));
                                setContextMenu(null);
                            }}
                            onSaveAsset={() => {
                                if (!contextNode) return;
                                void saveNodeAsset(contextNode);
                                setContextMenu(null);
                            }}
                            onShowInfo={() => {
                                if (contextMenu.type !== "node") return;
                                setInfoNodeId(contextMenu.nodeId);
                                setContextMenu(null);
                            }}
                            onViewImage={() => {
                                if (!contextNode) return;
                                void openNodeLightbox(contextNode);
                                setContextMenu(null);
                            }}
                            onCopyImage={() => {
                                if (!contextNode) return;
                                void copyNodeImage(contextNode);
                                setContextMenu(null);
                            }}
                            onDownloadImage={() => {
                                if (!contextNode) return;
                                downloadNodeImage(contextNode);
                                setContextMenu(null);
                            }}
                            onCopyNode={() => {
                                if (contextMenu.type !== "node") return;
                                copySingleNode(contextMenu.nodeId);
                                setContextMenu(null);
                            }}
                            onUpload={() => {
                                if (contextMenu.type !== "canvas") return;
                                handleUploadRequest(undefined, contextMenu.position);
                                setContextMenu(null);
                            }}
                            onSketch={() => {
                                if (contextMenu.type !== "canvas") return;
                                openSketchDialog(contextMenu.position);
                            }}
                            onAddNode={() => {
                                if (contextMenu.type !== "canvas") return;
                                setQuickNodeCreateMenu({ position: contextMenu.position });
                                setContextMenu(null);
                            }}
                            onUndo={() => {
                                undoCanvas();
                                setContextMenu(null);
                            }}
                            onRedo={() => {
                                redoCanvas();
                                setContextMenu(null);
                            }}
                            onCopyAll={() => {
                                copyAllNodes();
                                setContextMenu(null);
                            }}
                            onPaste={() => {
                                if (contextMenu.type === "canvas") {
                                    pasteCopiedNodes(contextMenu.position);
                                } else if (contextNode) {
                                    pasteCopiedNodes({
                                        x: contextNode.position.x + contextNode.width / 2 + 48,
                                        y: contextNode.position.y + contextNode.height / 2 + 48,
                                    });
                                }
                                setContextMenu(null);
                            }}
                        />
                    ) : null}
                </InfiniteCanvas>

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || nodeImageSettingsOpen ? null : toolbarNode}
                    viewport={viewport}
                    selectedCount={selectedNodeIds.size}
                    selectionBounds={isNodeDragging || nodeImageSettingsOpen ? null : selectedNodesBounds}
                    group={isNodeDragging || nodeImageSettingsOpen ? null : selectedGroup}
                    groupBounds={isNodeDragging || nodeImageSettingsOpen ? null : selectedGroupBounds}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onCreateGroup={createGroupFromSelection}
                    onDeleteSelection={() => deleteNodes(new Set(selectedNodeIds))}
                    onGroupLayout={applyGroupLayout}
                    onGroupColor={changeGroupColor}
                    onGroupExecute={executeGroup}
                    onGroupRename={renameGroup}
                    onGroupUngroup={ungroupNodes}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onEditText={openTextEditor}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onGridCrop={(node, rows, cols) => void cropImageNodeGrid(node, rows, cols)}
                    onCustomGridCrop={(node) => cropImageNodeCustomGrid(node)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={(node) => void openNodeLightbox(node)}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                />

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    interactionMode={interactionMode}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    onInteractionModeChange={setInteractionMode}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddConfig={() => createNode(CanvasNodeType.Config)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onOpenSketch={() => openSketchDialog()}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                    onOpenAssetLibrary={() => {
                        assetInsertPositionRef.current = null;
                        setAssetPickerTab("canvas");
                        setAssetPickerOpen(true);
                    }}
                    onOpenMyAssets={() => {
                        assetInsertPositionRef.current = null;
                        setAssetPickerTab("my-assets");
                        setAssetPickerOpen(true);
                    }}
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} />

                <input ref={imageInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} inputs={infoNode ? buildNodeGenerationInputs(infoNode.id, nodes, connections) : []} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}

                <CanvasSketchDialog open={Boolean(sketchDialog)} onClose={() => setSketchDialog(null)} onSave={saveSketchToCanvas} />

                <Modal
                    title="图片详情"
                    open={Boolean(previewNode?.metadata?.content)}
                    centered
                    onCancel={() => setPreviewNodeId(null)}
                    footer={null}
                    width="auto"
                    styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewNode?.metadata?.content ? (
                        <img
                            src={previewNode.metadata.content}
                            alt={previewNode.title || "图片"}
                            style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }}
                        />
                    ) : null}
                </Modal>

                <Modal
                    title="清空画布？"
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>取消</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                清空
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">这会删除当前画布上的所有节点和连线。</p>
                </Modal>

                <AssetPickerModal
                    open={assetPickerOpen}
                    defaultTab={assetPickerTab}
                    canvasNodes={nodes}
                    onRenameCanvasNode={renameCanvasNode}
                    onChangeCanvasNodeCategory={(nodeId, category) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, assetCategory: category } } : node)))}
                    onDeleteCanvasNode={(nodeId) => deleteNodes(new Set([nodeId]))}
                    onInsert={handleAssetInsert}
                    onClose={() => {
                        assetInsertPositionRef.current = null;
                        setAssetPickerOpen(false);
                    }}
                />

                <Modal
                    title="加入我的素材"
                    open={Boolean(pendingAssetSave)}
                    centered
                    destroyOnHidden
                    okText="保存"
                    cancelText="取消"
                    onCancel={() => setPendingAssetSave(null)}
                    onOk={confirmSaveNodeAsset}
                >
                    <div className="space-y-4 pt-1">
                        <AssetSavePreview node={pendingAssetSave?.node || null} />
                        <label className="block space-y-1.5">
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">名称</span>
                            <Input value={pendingAssetSave?.title || ""} placeholder="输入素材名称" onChange={(event) => setPendingAssetSave((current) => (current ? { ...current, title: event.target.value } : current))} />
                        </label>
                        <label className="block space-y-1.5">
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">子分类</span>
                            <div className="flex overflow-hidden rounded-lg border border-stone-300 bg-stone-100 divide-x divide-stone-300 dark:border-stone-700 dark:bg-stone-950 dark:divide-stone-700">
                                {ASSET_CATEGORIES.map((category) => {
                                    const active = (pendingAssetSave?.category || "其他") === category;
                                    return (
                                        <button
                                            key={category}
                                            type="button"
                                            className={`h-9 min-w-0 flex-1 px-2 text-sm transition ${active ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950" : "text-stone-700 hover:bg-stone-200 dark:text-stone-200 dark:hover:bg-stone-800"}`}
                                            onClick={() => setPendingAssetSave((current) => (current ? { ...current, category } : current))}
                                        >
                                            {category}
                                        </button>
                                    );
                                })}
                            </div>
                        </label>
                    </div>
                </Modal>
            </section>
        </main>
    );
}

function AssetSavePreview({ node }: { node: CanvasNodeData | null }) {
    if (!node) return null;
    const content = node.metadata?.content || "";
    const label = node.type === CanvasNodeType.Image ? "图片预览" : node.type === CanvasNodeType.Video ? "视频预览" : "文本预览";

    return (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="flex items-center justify-between border-b border-stone-200 px-3 py-2 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400">
                <span>{label}</span>
                <span>{node.type === CanvasNodeType.Image ? "图片" : node.type === CanvasNodeType.Video ? "视频" : "文本"}</span>
            </div>
            {node.type === CanvasNodeType.Image && content ? (
                <div className="flex max-h-64 items-center justify-center bg-black/5 p-2 dark:bg-black/25">
                    <img src={content} alt={node.title || "素材预览"} className="max-h-60 max-w-full rounded-lg object-contain" />
                </div>
            ) : node.type === CanvasNodeType.Video && content ? (
                <div className="flex max-h-64 items-center justify-center bg-black p-2">
                    <video src={content} className="max-h-60 max-w-full rounded-lg object-contain" controls muted playsInline />
                </div>
            ) : (
                <div className="max-h-40 overflow-auto p-3 text-sm leading-6 text-stone-700 dark:text-stone-200">{content || node.title || "暂无内容"}</div>
            )}
        </div>
    );
}

function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onImportImage,
    onUndo,
    onRedo,
    onOpenSettings,
    isPureBackground,
    onTogglePureBackground,
    apiBalanceText,
    activeProfile,
    onQueryBalance,
    isQueryingBalance,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onImportImage: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onOpenSettings: () => void;
    isPureBackground: boolean;
    onTogglePureBackground: () => void;
    apiBalanceText: string;
    activeProfile: any;
    onQueryBalance: () => void;
    isQueryingBalance: boolean;
}) {
    const router = useRouter();
    const fallbackTheme = useThemeStore((state) => state.theme);
    const setColorTheme = useThemeStore((state) => state.setTheme);
    const colorTheme = router.appearanceTheme || fallbackTheme;
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const syncColorTheme = (nextTheme: "light" | "dark") => {
        setColorTheme(nextTheme);
        router.setAppearanceTheme(nextTheme);
    };

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between px-4">
                <div
                    className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-2xl border px-2 py-1.5 shadow-sm backdrop-blur-md"
                    style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                >
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: "主页", onClick: onHome },
                                { key: "projects", icon: <Images className="size-4" />, label: "我的画布", onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: "导入图片", onClick: onImportImage },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button type="button" className="grid h-9 w-9 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                            <Menu className="size-5" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="flex min-w-0 items-center gap-2">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title="双击修改画布名称"
                            >
                                {title}
                            </button>
                        )}
                    </div>
                </div>

                {/* 中间余额面板和文运工坊保持一致，展示当前固定站点名称。 */}
                <div className="pointer-events-auto flex max-w-[48vw] items-center gap-2 rounded-full border py-1 pl-3 pr-1 text-xs font-medium shadow-sm backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }}>
                    <span className="min-w-0 truncate">{activeProfile?.name || "当前站点"}：{apiBalanceText || "未查询"}</span>
                    <button
                        type="button"
                        onClick={onQueryBalance}
                        disabled={isQueryingBalance}
                        className="shrink-0 rounded-full bg-blue-500 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isQueryingBalance ? "查询中" : "查询"}
                    </button>
                    <PriceTableButton
                        activeProfile={activeProfile}
                        buttonClassName="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium transition hover:opacity-85"
                        buttonStyle={{ background: theme.node.fill, color: theme.node.text }}
                    />
                </div>

                <div className="pointer-events-auto flex items-center gap-1.5">
                    {/* 切换纯色背景按钮 */}
                    <button
                        type="button"
                        className={cn(
                            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition hover:bg-white dark:hover:bg-white/10",
                            isPureBackground && "border border-primary/50"
                        )}
                        style={{
                            background: theme.toolbar.panel,
                            color: isPureBackground ? "var(--ant-primary-color)" : theme.node.text,
                            boxShadow: "0 10px 30px rgba(28,25,23,.10)"
                        }}
                        onClick={onTogglePureBackground}
                        aria-label="快速切换纯色背景"
                        title="快速切换纯色背景"
                    >
                        <Paintbrush className="size-5" />
                    </button>
                    <button type="button" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition hover:bg-white dark:hover:bg-white/10" style={{ background: theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }} onClick={() => setShortcutsOpen(true)} aria-label="快捷键" title="快捷键">
                        <Keyboard className="size-5" />
                    </button>
                    <AnimatedThemeToggler
                        theme={colorTheme}
                        onThemeChange={syncColorTheme}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition hover:bg-white dark:hover:bg-white/10 [&_svg]:h-5 [&_svg]:w-5"
                        style={{ background: theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                        aria-label={colorTheme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                        title={colorTheme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                    />
                    <Button
                        type="text"
                        className="!h-9 !w-9 !min-w-9 !rounded-xl !p-0"
                        style={{ background: theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                        icon={<Settings className="size-4.5" />}
                        onClick={onOpenSettings}
                        aria-label="设置"
                        title="设置"
                    />
                </div>
            </div>
            <Modal title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["拖动画布"]} value="平移视图" />
                    <Shortcut keys={["滚轮"]} value="缩放画布" />
                    <Shortcut keys={["双击空白处"]} value="快速添加节点" />
                    <Shortcut keys={["缩放滑杆"]} value="精确调整缩放" />
                    <Shortcut keys={["点击模式", "拖动空白"]} value="框选多个节点" />
                    <Shortcut keys={["框选多个节点", "打组"]} value="创建可拖动组" />
                    <Shortcut keys={["组工具条"]} value="整组执行 / 解组 / 改色 / 改布局" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut keys={["Delete / Backspace"]} value="删除选中" />
                    <Shortcut keys={["Esc"]} value="取消选择并关闭浮层" />
                    <Shortcut keys={["拖入图片"]} value="上传到画布" />
                </div>
            </Modal>
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}

function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4" };
}

function buildGenerationTiming(startedAt: number): Pick<CanvasNodeMetadata, "generationStartedAt" | "generationElapsedMs"> {
    return { generationStartedAt: startedAt, generationElapsedMs: Math.max(0, Date.now() - startedAt) };
}

function getGeneratedMediaSizePatch(node: CanvasNodeData, size: { width: number; height: number }): Partial<CanvasNodeData> {
    if (node.metadata?.manualSize) return {};
    return {
        position: {
            x: node.position.x + node.width / 2 - size.width / 2,
            y: node.position.y + node.height / 2 - size.height / 2,
        },
        width: size.width,
        height: size.height,
    };
}

function getGeneratedNodeTitle(node: CanvasNodeData, generatedTitle: string) {
    // 用户手动改过节点小标题后，生成流程只更新内容，不再覆盖这个名称。
    return node.metadata?.manualTitle ? node.title : generatedTitle;
}

function formatCanvasPromptForApi(prompt: string, imageCount: number) {
    return stripImageMentionMarkers(replaceImageMentionsForApi(prompt, imageCount, (index) => `[reference image ${index + 1}]`));
}

function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[], generationPrompt?: string): CanvasNodeMetadata {
    return {
        generationType: type,
        generationPrompt,
        model: config.model,
        size: config.size,
        quality: config.quality,
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

async function hydrateManualReferenceImages(references?: CanvasNodeMetadata["referenceImages"]): Promise<ReferenceImage[]> {
    return Promise.all(
        (references || []).map(async (image) => ({
            id: image.id,
            name: image.name,
            type: image.mimeType || image.type || "image/png",
            dataUrl: await imageToDataUrl(image),
            url: image.url,
            storageKey: image.storageKey,
            maskDataUrl: image.maskDataUrl,
            isMaskTarget: image.isMaskTarget,
        })),
    );
}

function withMergedReferenceImages<T extends { referenceImages: ReferenceImage[]; imageCount?: number }>(context: T, manualReferences: ReferenceImage[]): T {
    const referenceImages = mergeNodeReferenceImages(manualReferences, context.referenceImages);
    return { ...context, referenceImages, imageCount: referenceImages.length };
}

function getNodeOwnPrompt(sourceNode: CanvasNodeData, node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const rawPrompt = sourceNode.metadata?.prompt || node.metadata?.prompt || "";
    const connectedPrompt = buildConnectedPromptText(buildNodeGenerationInputs(sourceNode.id, nodes, connections));
    return stripConnectedPromptSuffix(rawPrompt, connectedPrompt).trim();
}

async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const content = node.metadata?.content;
            if (node.type === CanvasNodeType.Video && node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveMediaUrl(node.metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image || !content) return node;
            if (node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveImageUrl(node.metadata.storageKey, content) } };
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...node.metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                    images: await Promise.all((message.images || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

function clampGridCropSize(value: number) {
    return Math.max(1, Math.min(8, Math.floor(Math.abs(value) || 1)));
}

function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const next = { ...node, metadata: { ...node.metadata, ...(patch || {}) } };
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof patch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(patch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    if (first.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    return { fromNodeId: first.id, toNodeId: second.id };
}

function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
    };
}

function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode, activeProfileId: string): AiConfig {
    const defaultModel = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : config.textModel;
    const model = node?.metadata?.model || defaultModel || config.model || defaultConfig.model;
    const resolvedModel = mode === "image" ? normalizeImageModelForProfile(model, activeProfileId) : model;
    return {
        ...config,
        model: resolvedModel,
        imageModel: mode === "image" ? resolvedModel : config.imageModel,
        textModel: mode === "text" ? resolvedModel : config.textModel,
        videoModel: mode === "video" ? resolvedModel : config.videoModel,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: normalizeImageSizeForProfile(node?.metadata?.size || config.size || defaultConfig.size, activeProfileId),
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        count: String(node?.metadata?.count || (mode === "image" ? 1 : config.count) || defaultConfig.count),
    };
}

function isCanvasGenerationConfigReady(config: AiConfig, mode: CanvasNodeGenerationMode, isAiConfigReady: (config: AiConfig, model: string) => boolean) {
    const model = mode === "image" ? config.imageModel || config.model : mode === "video" ? config.videoModel || config.model : config.textModel || config.model;
    if (!model.trim()) return false;
    if (config.channelMode === "remote") return true;
    if (mode === "image") return isAiConfigReady(config, model);
    if (mode === "text") return Boolean((config.textBaseUrl.trim() && config.textApiKey.trim()) || (config.textVideoBaseUrl.trim() && config.textVideoApiKey.trim()) || (config.baseUrl.trim() && config.apiKey.trim()));
    // 视频节点只使用视频相关接口，避免误把出图 API 当成视频接口后连续返回 404。
    return Boolean(
        (config.videoBaseUrl.trim() && (config.videoApiKey.trim() || config.textVideoApiKey.trim() || config.textApiKey.trim() || config.apiKey.trim())) ||
            (config.textVideoBaseUrl.trim() && (config.textVideoApiKey.trim() || config.videoApiKey.trim() || config.textApiKey.trim() || config.apiKey.trim())) ||
            (config.textBaseUrl.trim() && (config.textApiKey.trim() || config.videoApiKey.trim() || config.textVideoApiKey.trim() || config.apiKey.trim())),
    );
}

function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

function cubicPoint(p0: Position, p1: Position, p2: Position, p3: Position, t: number): Position {
    const a = 1 - t;
    return {
        x: a ** 3 * p0.x + 3 * a ** 2 * t * p1.x + 3 * a * t ** 2 * p2.x + t ** 3 * p3.x,
        y: a ** 3 * p0.y + 3 * a ** 2 * t * p1.y + 3 * a * t ** 2 * p2.y + t ** 3 * p3.y,
    };
}

function isHiddenBatchChild(node: CanvasNodeData, nodes: CanvasNodeData[], collapsingBatchIds?: Set<string>) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    if (root && collapsingBatchIds?.has(rootId)) return false;
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

function isHiddenBatchConnectionEndpoint(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

function buildAnglePrompt(params: CanvasImageAngleParams) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${buildAngleLabel(params)}。`;
}
