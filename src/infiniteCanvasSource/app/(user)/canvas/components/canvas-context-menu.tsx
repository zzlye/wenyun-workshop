"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Clipboard, Copy, Download, Eye, ImagePlus, Layers, Paintbrush, Plus, Redo2, Save, Trash2, Undo2, Upload, ZoomIn } from "lucide-react";

import type { ContextMenuState } from "../types";

type CanvasContextMenuProps = {
    menu: ContextMenuState;
    scale?: number;
    canUndo?: boolean;
    canRedo?: boolean;
    canPaste?: boolean;
    isImageNode?: boolean;
    hasNodeContent?: boolean;
    onClose: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onSaveAsset?: () => void;
    onShowInfo?: () => void;
    onViewImage?: () => void;
    onCopyImage?: () => void;
    onDownloadImage?: () => void;
    onCopyNode?: () => void;
    onUpload?: () => void;
    onSketch?: () => void;
    onAddNode?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    onCopyAll?: () => void;
    onPaste?: () => void;
};

export function CanvasNodeContextMenu({
    menu,
    scale = 1,
    canUndo = false,
    canRedo = false,
    canPaste = false,
    isImageNode = false,
    hasNodeContent = false,
    onClose,
    onDuplicate,
    onDelete,
    onSaveAsset,
    onShowInfo,
    onViewImage,
    onCopyImage,
    onDownloadImage,
    onCopyNode,
    onUpload,
    onSketch,
    onAddNode,
    onUndo,
    onRedo,
    onCopyAll,
    onPaste,
}: CanvasContextMenuProps) {
    const menuBackground = "#1f1f1f";
    const menuBorder = "rgba(255,255,255,.1)";
    const menuPosition = menu.position;
    const inverseScale = 1 / Math.max(scale, 0.01);

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="absolute z-[80] w-[240px] rounded-2xl border p-2 shadow-2xl"
            style={{ left: menuPosition.x, top: menuPosition.y, background: menuBackground, borderColor: menuBorder, color: "#f8fafc", transform: `scale(${inverseScale})`, transformOrigin: "top left" }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {menu.type === "canvas" ? (
                <>
                    <CanvasMenuButton icon={<Upload className="size-4" />} label="上传" onClick={onUpload} />
                    <CanvasMenuButton icon={<Paintbrush className="size-4" />} label="画笔" onClick={onSketch} />
                    <CanvasMenuButton icon={<Plus className="size-4" />} label="添加节点" onClick={onAddNode} />
                    <MenuDivider />
                    <CanvasMenuButton icon={<Undo2 className="size-4" />} label="撤销" shortcut="Ctrl+Z" disabled={!canUndo} onClick={onUndo} />
                    <CanvasMenuButton icon={<Redo2 className="size-4" />} label="重做" shortcut="Shift+Ctrl+Z" disabled={!canRedo} onClick={onRedo} />
                    <MenuDivider />
                    <CanvasMenuButton icon={<Copy className="size-4" />} label="复制所有节点" onClick={onCopyAll} />
                    <CanvasMenuButton icon={<Clipboard className="size-4" />} label="粘贴" shortcut="Ctrl+V" disabled={!canPaste} onClick={onPaste} />
                </>
            ) : (
                <>
                    <CanvasMenuButton icon={<Save className="size-4" />} label="加入我的素材" disabled={!hasNodeContent} onClick={onSaveAsset} />
                    <MenuDivider />
                    {isImageNode ? <CanvasMenuButton icon={<ZoomIn className="size-4" />} label="放大图片" disabled={!hasNodeContent} onClick={onViewImage} /> : null}
                    <CanvasMenuButton icon={<Eye className="size-4" />} label="显示简介" onClick={onShowInfo} />
                    {isImageNode ? <CanvasMenuButton icon={<ImagePlus className="size-4" />} label="复制图片" disabled={!hasNodeContent} onClick={onCopyImage} /> : null}
                    {isImageNode ? <CanvasMenuButton icon={<Download className="size-4" />} label="下载图片" disabled={!hasNodeContent} onClick={onDownloadImage} /> : null}
                    <MenuDivider />
                    <CanvasMenuButton icon={<Layers className="size-4" />} label="创建副本" onClick={onDuplicate} />
                    <CanvasMenuButton icon={<Copy className="size-4" />} label="复制节点" onClick={onCopyNode} />
                    <CanvasMenuButton icon={<Clipboard className="size-4" />} label="粘贴节点" disabled={!canPaste} onClick={onPaste} />
                    <CanvasMenuButton icon={<Trash2 className="size-4" />} label="删除节点" danger onClick={onDelete} />
                </>
            )}
        </div>
    );
}

function MenuDivider() {
    return <div className="mx-2 my-1.5 h-px bg-white/10" />;
}

function CanvasMenuButton({ icon, label, shortcut, disabled = false, danger = false, onClick }: { icon: ReactNode; label: string; shortcut?: string; disabled?: boolean; danger?: boolean; onClick?: () => void }) {
    return (
        <button type="button" className="flex h-12 w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 text-left text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-25" style={{ color: danger ? "#f87171" : "#f8fafc" }} disabled={disabled} onClick={disabled ? undefined : onClick}>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 text-white/70">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold leading-5">{label}</span>
                {shortcut ? <span className="mt-0.5 block truncate text-xs font-normal text-white/45">{shortcut}</span> : null}
            </span>
        </button>
    );
}
