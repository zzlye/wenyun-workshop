"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Popover, Segmented, Tooltip } from "antd";
import { Camera, Download, FolderPlus, Grid2x2, Grid3x3, Group, Image as ImageIcon, Info, LayoutGrid, Lock, LockOpen, Maximize2, MessageSquare, Minus, Palette, Pencil, Play, Plus, RefreshCw, Rows3, Scissors, Settings2, Trash2, Ungroup, Upload, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasGroupData, type CanvasGroupLayout, type CanvasNodeData, type ViewportTransform } from "../types";
import { buildConnectedPromptText, type NodeGenerationInput } from "./canvas-node-generation";

type CanvasToolbarBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type CanvasNodeHoverToolbarProps = {
    node: CanvasNodeData | null;
    viewport: ViewportTransform;
    selectedCount?: number;
    selectionBounds?: CanvasToolbarBounds | null;
    group?: CanvasGroupData | null;
    groupBounds?: CanvasToolbarBounds | null;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onCreateGroup?: () => void;
    onDeleteSelection?: () => void;
    onGroupLayout?: (groupId: string, layout: CanvasGroupLayout) => void;
    onGroupColor?: (groupId: string, color: string) => void;
    onGroupExecute?: (groupId: string) => void;
    onGroupRename?: (groupId: string, title: string) => void;
    onGroupUngroup?: (groupId: string) => void;
    onInfo: (node: CanvasNodeData) => void;
    onEditText: (node: CanvasNodeData) => void;
    onDecreaseFont: (node: CanvasNodeData) => void;
    onIncreaseFont: (node: CanvasNodeData) => void;
    onToggleDialog: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onUpload: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onGridCrop: (node: CanvasNodeData, rows: number, cols: number) => void;
    onCustomGridCrop: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
};

export function CanvasNodeHoverToolbar({
    node,
    viewport,
    selectedCount = 0,
    selectionBounds,
    group,
    groupBounds,
    onKeep,
    onLeave,
    onCreateGroup,
    onDeleteSelection,
    onGroupLayout,
    onGroupColor,
    onGroupExecute,
    onGroupRename,
    onGroupUngroup,
    onInfo,
    onEditText,
    onDecreaseFont,
    onIncreaseFont,
    onToggleDialog,
    onGenerateImage,
    onUpload,
    onDownload,
    onSaveAsset,
    onCrop,
    onGridCrop,
    onCustomGridCrop,
    onAngle,
    onViewImage,
    onRetry,
    onToggleFreeResize,
    onDelete,
}: CanvasNodeHoverToolbarProps) {
    if (group && groupBounds) {
        const { left, top } = getBoundsToolbarPosition(groupBounds, viewport);
        return (
            <div
                className="absolute z-[80] flex h-12 max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-full items-center gap-1 overflow-x-auto overflow-y-visible rounded-[18px] border border-black/10 bg-white px-2 text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)] [&>*]:shrink-0"
                style={{ left, top }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <span className="flex items-center gap-1.5 px-2 text-sm font-semibold whitespace-nowrap text-[#5f6368]">
                    <Palette className="size-4" />
                    颜色
                </span>
                <div className="flex items-center gap-1 px-0.5">
                    {groupColors.map((color) => (
                        <button
                            key={color}
                            type="button"
                            className="size-5 rounded-full border transition hover:scale-110"
                            style={{ background: color, borderColor: color === group.color ? "#ffffff" : "rgba(0,0,0,.16)", boxShadow: color === group.color ? `0 0 0 2px ${color}` : undefined }}
                            onClick={() => onGroupColor?.(group.id, color)}
                            aria-label={`切换组颜色 ${color}`}
                        />
                    ))}
                </div>
                <ToolbarDivider />
                <GroupToolbarAction title="宫格布局" label="宫格" icon={<LayoutGrid className="size-4" />} active={group.layout === "grid"} onClick={() => onGroupLayout?.(group.id, "grid")} />
                <GroupToolbarAction title="水平布局" label="水平" icon={<Rows3 className="size-4 rotate-90" />} active={group.layout === "horizontal"} onClick={() => onGroupLayout?.(group.id, "horizontal")} />
                <GroupToolbarAction title="垂直布局" label="垂直" icon={<Rows3 className="size-4" />} active={group.layout === "vertical"} onClick={() => onGroupLayout?.(group.id, "vertical")} />
                <GroupToolbarAction title="自由布局" label="自由" icon={<Grid2x2 className="size-4" />} active={group.layout === "free"} onClick={() => onGroupLayout?.(group.id, "free")} />
                <ToolbarDivider />
                <GroupToolbarAction title="整组执行" label="整组执行" icon={<Play className="size-4" />} strong onClick={() => onGroupExecute?.(group.id)} />
                <GroupToolbarAction title="重命名组" label="命名" icon={<Pencil className="size-4" />} onClick={() => {
                    const nextTitle = window.prompt("组名称", group.title);
                    if (nextTitle?.trim()) onGroupRename?.(group.id, nextTitle);
                }} />
                <GroupToolbarAction title="解组" label="解组" icon={<Ungroup className="size-4" />} danger onClick={() => onGroupUngroup?.(group.id)} />
            </div>
        );
    }

    if (selectionBounds && selectedCount > 1) {
        const { left, top } = getBoundsToolbarPosition(selectionBounds, viewport);
        return (
            <div
                className="absolute z-[80] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border border-black/10 bg-white text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
                style={{ left, top }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <span className="px-4 text-sm font-semibold text-[#5f6368]">已选 {selectedCount} 个</span>
                <ToolbarDivider />
                <ToolbarAction title="将选中节点打组" label="打组" icon={<Group className="size-4" />} onClick={onCreateGroup} />
                <ToolbarAction title="删除选中节点" label="删除" icon={<Trash2 className="size-4" />} onClick={onDeleteSelection} danger />
            </div>
        );
    }

    if (!node) return null;

    const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const top = viewport.y + node.position.y * viewport.k - 42;
    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const hasVideo = isVideo && Boolean(node.metadata?.content);
    const isText = node.type === CanvasNodeType.Text;
    const isConfig = node.type === CanvasNodeType.Config;
    const canOpenDialog = isText || hasImage || isVideo;
    const canRetry = node.metadata?.status === "error";
    const hasSpecificTools = canRetry || isText || isImage || isVideo || isConfig;

    return (
        <div
            className="absolute z-[70] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border border-black/10 bg-white text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
            style={{ left, top }}
            onMouseEnter={() => onKeep(node.id)}
            onMouseLeave={onLeave}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <ToolbarAction title="查看节点信息" label="信息" icon={<Info className="size-4" />} onClick={() => onInfo(node)} />
            <ToolbarAction title="移除节点" label="删除" icon={<Trash2 className="size-4" />} onClick={() => onDelete(node)} danger />
            {hasSpecificTools ? <ToolbarDivider /> : null}
            {canRetry ? <ToolbarAction title="重新生成" label="重试" icon={<RefreshCw className="size-4" />} onClick={() => onRetry(node)} /> : null}
            {hasImage || hasVideo || isText ? <ToolbarAction title="加入我的素材" label="存素材" icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(node)} /> : null}
            {hasImage || hasVideo ? <IconAction title={hasVideo ? "下载视频" : "下载图片"} icon={<Download className="size-5" />} onClick={() => onDownload(node)} /> : null}
            {canOpenDialog ? <ToolbarAction title="编辑" label="编辑" icon={<MessageSquare className="size-4" />} onClick={() => onToggleDialog(node)} /> : null}
            {isText ? <ToolbarAction title="编辑文本" label="编辑文字" icon={<Pencil className="size-4" />} onClick={() => onEditText(node)} /> : null}
            {isText ? <ToolbarAction title="用文本生图" label="生图" icon={<ImageIcon className="size-4" />} onClick={() => onGenerateImage(node)} /> : null}
            {isConfig ? <ToolbarAction title="生成配置" label="生成配置" icon={<Settings2 className="size-4" />} onClick={() => onInfo(node)} /> : null}
            {isText ? <ToolbarAction title="减小字号" label="缩小" icon={<Minus className="size-4" />} onClick={() => onDecreaseFont(node)} /> : null}
            {isText ? <ToolbarAction title="增大字号" label="放大" icon={<Plus className="size-4" />} onClick={() => onIncreaseFont(node)} /> : null}
            {isImage ? <ToolbarAction title={hasImage ? "替换图片" : "上传图片"} label={hasImage ? "替换图片" : "上传图片"} icon={<Upload className="size-4" />} onClick={() => onUpload(node)} /> : null}
            {isVideo ? <ToolbarAction title={hasVideo ? "替换视频" : "上传视频"} label={hasVideo ? "替换视频" : "上传视频"} icon={<Video className="size-4" />} onClick={() => onUpload(node)} /> : null}
            {hasImage ? (
                <ToolbarAction
                    title={node.metadata?.freeResize ? "切换为等比缩放" : "切换为自由比例"}
                    label={node.metadata?.freeResize ? "自由比例" : "锁比例"}
                    icon={node.metadata?.freeResize ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
                    onClick={() => onToggleFreeResize(node)}
                    active={node.metadata?.freeResize}
                />
            ) : null}
            {hasImage ? <ToolbarAction title="裁剪并生成新节点" label="裁剪" icon={<Scissors className="size-4" />} onClick={() => onCrop(node)} /> : null}
            {hasImage ? <GridCropAction node={node} onGridCrop={onGridCrop} onCustomGridCrop={onCustomGridCrop} /> : null}
            {hasImage ? <ToolbarAction title="生成角度" label="多角度" icon={<Camera className="size-4" />} onClick={() => onAngle(node)} /> : null}
            {hasImage ? <ToolbarAction title="查看图片详情" label="查看大图" icon={<Maximize2 className="size-4" />} onClick={() => onViewImage(node)} /> : null}
        </div>
    );
}

export function CanvasNodeInfoModal({ node, inputs = [], open, onClose }: { node: CanvasNodeData | null; inputs?: NodeGenerationInput[]; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [view, setView] = useState<"info" | "json">("info");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.batchChildIds?.length || 0 : 0;
    const generationDuration = formatGenerationDuration(node?.metadata?.generationElapsedMs);
    const isMedia = node?.type === CanvasNodeType.Image || node?.type === CanvasNodeType.Video;
    const mediaResolution = isMedia
        ? node?.metadata?.naturalWidth && node?.metadata?.naturalHeight
            ? `${Math.round(node.metadata.naturalWidth)} x ${Math.round(node.metadata.naturalHeight)}`
            : "待获取"
        : `${Math.round(node?.width || 0)} x ${Math.round(node?.height || 0)}`;
    const connectedPromptText = useMemo(() => buildConnectedPromptText(inputs), [inputs]);
    const displayPrompt = useMemo(() => {
        const savedGenerationPrompt = node?.metadata?.generationPrompt?.trim() || "";
        if (savedGenerationPrompt) return savedGenerationPrompt;
        const ownPrompt = node?.metadata?.prompt?.trim() || "";
        if (ownPrompt && connectedPromptText) return `${ownPrompt}\n\n${connectedPromptText}`;
        return ownPrompt || connectedPromptText;
    }, [connectedPromptText, node?.metadata?.generationPrompt, node?.metadata?.prompt]);
    const textContent = node?.type === CanvasNodeType.Text ? node.metadata?.content?.trim() || "" : "";
    const json = useMemo(() => {
        if (!node) return "";
        return JSON.stringify(
            node,
            (key, value) => {
                if (key === "title") return undefined;
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }
                return value;
            },
            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

    const title = (
        <div className="flex items-center justify-between gap-4 pr-12">
            <span>节点信息</span>
            <Segmented
                size="small"
                value={view}
                onChange={(value) => setView(value as "info" | "json")}
                options={[
                    { label: "信息", value: "info" },
                    { label: "JSON", value: "json" },
                ]}
            />
        </div>
    );

    return (
        <Modal className="canvas-node-info-modal" title={title} open={open && Boolean(node)} centered footer={null} onCancel={onClose}>
            {node ? (
                <div className="h-[56vh] min-h-[360px] text-sm">
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
                            <InfoRow label="ID" value={node.id} />
                            <InfoRow label="类型" value={node.type === CanvasNodeType.Text ? "文本" : node.type === CanvasNodeType.Image ? "图片" : node.type === CanvasNodeType.Video ? "视频" : "生成配置"} />
                            <InfoRow label={isMedia ? "分辨率" : "尺寸"} value={mediaResolution} />
                            <InfoRow label="位置" value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                            <InfoRow label="状态" value={node.metadata?.status || "idle"} />
                            {generationDuration ? <InfoRow label="生成用时" value={generationDuration} /> : null}
                            {batchCount > 1 ? <InfoRow label="图片组" value={`${batchCount} 张`} /> : null}
                            {displayPrompt ? <InfoRow label="提示词" value={displayPrompt} /> : null}
                            {textContent ? <InfoRow label="文本内容" value={textContent} /> : null}
                            {imageBytes ? <InfoRow label="图片大小" value={formatBytes(imageBytes)} /> : null}
                            {node.metadata?.errorDetails ? (
                                <div className="rounded-lg border p-3 text-red-400" style={{ borderColor: theme.node.stroke }}>
                                    {node.metadata.errorDetails}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

function ToolbarAction({ title, label, icon, onClick, hint, active = false, danger = false }: { title: string; label: string; icon: ReactNode; onClick?: () => void; hint?: string; active?: boolean; danger?: boolean }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2}>
            <button type="button" className={`group relative flex h-12 items-center whitespace-nowrap px-1.5 ${danger ? "text-[#ef4444]" : ""}`} onClick={onClick} aria-label={title}>
                <span className={`flex h-9 items-center gap-2 rounded-lg px-2.5 transition group-hover:bg-[#f0f0f1] ${active ? "bg-[#eeeeef]" : ""}`}>
                    {icon}
                    <span>{label}</span>
                    {hint ? <span className="text-[#a3a3a3]">{hint}</span> : null}
                </span>
            </button>
        </Tooltip>
    );
}

function IconAction({ title, icon, onClick }: { title: string; icon: ReactNode; onClick: () => void }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2}>
            <button type="button" className="group relative grid h-12 w-12 place-items-center px-1.5" onClick={onClick} aria-label={title}>
                <span className="grid size-9 place-items-center rounded-lg transition group-hover:bg-[#f0f0f1]">{icon}</span>
            </button>
        </Tooltip>
    );
}

function ToolbarDivider() {
    return <span className="mx-1 h-7 w-px scale-x-50 bg-[#dedee2]" />;
}

const gridCropOptions = [
    { key: "2x2", rows: 2, cols: 2, label: "4宫格裁剪", description: "2x2 网格" },
    { key: "3x3", rows: 3, cols: 3, label: "9宫格裁剪", description: "3x3 网格" },
    { key: "4x4", rows: 4, cols: 4, label: "16宫格裁剪", description: "4x4 网格" },
    { key: "5x5", rows: 5, cols: 5, label: "25宫格裁剪", description: "5x5 网格" },
];

function GridCropAction({ node, onGridCrop, onCustomGridCrop }: { node: CanvasNodeData; onGridCrop: (node: CanvasNodeData, rows: number, cols: number) => void; onCustomGridCrop: (node: CanvasNodeData) => void }) {
    const [open, setOpen] = useState(false);
    const chooseGrid = (rows: number, cols: number) => {
        setOpen(false);
        onGridCrop(node, rows, cols);
    };
    const chooseCustomGrid = () => {
        setOpen(false);
        onCustomGridCrop(node);
    };

    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger={["click"]}
            placement="bottom"
            arrow={false}
            content={
                <div className="w-64 overflow-hidden rounded-xl border border-black/10 bg-[#1f1f1f]/95 p-1.5 text-white shadow-2xl backdrop-blur-xl" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    {gridCropOptions.map((option) => (
                        <button key={option.key} type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/10" onClick={() => chooseGrid(option.rows, option.cols)}>
                            <GridIcon rows={option.rows} cols={option.cols} />
                            <span className="min-w-0">
                                <span className="block text-sm font-semibold">{option.label}</span>
                                <span className="block text-xs text-white/55">{option.description}</span>
                            </span>
                        </button>
                    ))}
                    <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/10" onClick={chooseCustomGrid}>
                        <Grid3x3 className="size-5 text-white/80" />
                        <span className="min-w-0">
                            <span className="block text-sm font-semibold">自定义宫格裁剪</span>
                            <span className="block text-xs text-white/55">自定义行 x 列</span>
                        </span>
                    </button>
                </div>
            }
        >
            <button type="button" className="group relative flex h-12 items-center whitespace-nowrap px-1.5" aria-label="宫格裁剪" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <span className="flex h-9 items-center gap-2 rounded-lg px-2.5 transition group-hover:bg-[#f0f0f1]">
                    <Grid2x2 className="size-4" />
                    <span>宫格裁剪</span>
                </span>
            </button>
        </Popover>
    );
}

function GridIcon({ rows, cols }: { rows: number; cols: number }) {
    const cells = Array.from({ length: rows * cols }, (_, index) => index);
    return (
        <span className="grid size-5 shrink-0 gap-px rounded-[3px] border border-white/65 p-px" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} aria-hidden="true">
            {cells.map((index) => (
                <span key={index} className="rounded-[1px] border border-white/65" />
            ))}
        </span>
    );
}

const groupColors = ["#2f80ff", "#22c55e", "#f59e0b", "#a855f7", "#ef4444"];

function GroupToolbarAction({ title, label, icon, active, strong, danger, onClick }: { title: string; label: string; icon: ReactNode; active?: boolean; strong?: boolean; danger?: boolean; onClick?: () => void }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2}>
            <button
                type="button"
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-semibold transition hover:bg-[#f0f0f1] ${strong ? "text-emerald-600" : ""} ${danger ? "text-red-500" : ""}`}
                style={active ? { background: "#eeeeef", color: "#2563eb" } : undefined}
                onClick={onClick}
                aria-label={title}
            >
                {icon}
                <span>{label}</span>
            </button>
        </Tooltip>
    );
}

function getBoundsToolbarPosition(bounds: CanvasToolbarBounds, viewport: ViewportTransform) {
    return {
        left: viewport.x + (bounds.x + bounds.width / 2) * viewport.k,
        top: viewport.y + bounds.y * viewport.k - 14,
    };
}

function formatGenerationDuration(ms?: number) {
    if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    return `${mm}:${ss}`;
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
            <span className="opacity-50">{label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        </div>
    );
}
