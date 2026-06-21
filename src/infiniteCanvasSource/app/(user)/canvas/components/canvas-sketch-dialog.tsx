"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal, Slider } from "antd";
import { Eraser, Paintbrush, RotateCcw, Save, Trash2 } from "lucide-react";

const SKETCH_WIDTH = 960;
const SKETCH_HEIGHT = 540;
const COLORS = ["#ef4444", "#111827", "#2563eb", "#16a34a", "#9333ea", "#f97316"];

type CanvasSketchDialogProps = {
    open: boolean;
    onClose: () => void;
    onSave: (dataUrl: string) => Promise<void> | void;
};

type DrawMode = "draw" | "erase";

type BrushCursor = {
    visible: boolean;
    x: number;
    y: number;
    diameter: number;
};

export function CanvasSketchDialog({ open, onClose, onSave }: CanvasSketchDialogProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const undoStackRef = useRef<ImageData[]>([]);
    const drawingRef = useRef<{ active: boolean; lastX: number; lastY: number }>({ active: false, lastX: 0, lastY: 0 });
    const [color, setColor] = useState(COLORS[0]);
    const [brushSize, setBrushSize] = useState(8);
    const [mode, setMode] = useState<DrawMode>("draw");
    const [hasInk, setHasInk] = useState(false);
    const [undoDepth, setUndoDepth] = useState(0);
    const [saving, setSaving] = useState(false);
    const [brushCursor, setBrushCursor] = useState<BrushCursor>({ visible: false, x: 0, y: 0, diameter: brushSize });

    const getContext = useCallback(() => canvasRef.current?.getContext("2d", { willReadFrequently: true }) || null, []);

    const fillWhite = useCallback(() => {
        const canvas = canvasRef.current;
        const context = getContext();
        if (!canvas || !context) return;
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalCompositeOperation = "source-over";
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.restore();
    }, [getContext]);

    const resetCanvas = useCallback(() => {
        undoStackRef.current = [];
        setUndoDepth(0);
        drawingRef.current = { active: false, lastX: 0, lastY: 0 };
        setBrushCursor((current) => ({ ...current, visible: false }));
        fillWhite();
        setHasInk(false);
        setMode("draw");
    }, [fillWhite]);

    useEffect(() => {
        if (!open) return;
        const frame = window.requestAnimationFrame(resetCanvas);
        return () => window.cancelAnimationFrame(frame);
    }, [open, resetCanvas]);

    const handleOpenChange = useCallback(
        (visible: boolean) => {
            if (visible) {
                window.setTimeout(resetCanvas, 0);
                return;
            }
            undoStackRef.current = [];
            drawingRef.current = { active: false, lastX: 0, lastY: 0 };
            setUndoDepth(0);
            setHasInk(false);
            setBrushCursor((current) => ({ ...current, visible: false }));
        },
        [resetCanvas],
    );

    const pushUndo = useCallback(() => {
        const canvas = canvasRef.current;
        const context = getContext();
        if (!canvas || !context) return;
        undoStackRef.current = [...undoStackRef.current.slice(-24), context.getImageData(0, 0, canvas.width, canvas.height)];
        setUndoDepth(undoStackRef.current.length);
    }, [getContext]);

    const getPoint = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / rect.width) * canvas.width,
            y: ((event.clientY - rect.top) / rect.height) * canvas.height,
        };
    }, []);

    const updateBrushCursor = useCallback(
        (event: ReactPointerEvent<HTMLCanvasElement>) => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const scale = rect.width / canvas.width;
            const diameter = (mode === "erase" ? brushSize * 1.8 : brushSize) * scale;
            setBrushCursor({
                visible: true,
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
                diameter: Math.max(4, diameter),
            });
        },
        [brushSize, mode],
    );

    const configureStroke = useCallback(
        (context: CanvasRenderingContext2D) => {
            context.lineCap = "round";
            context.lineJoin = "round";
            context.strokeStyle = mode === "erase" ? "#ffffff" : color;
            context.lineWidth = mode === "erase" ? brushSize * 1.8 : brushSize;
            context.globalCompositeOperation = "source-over";
        },
        [brushSize, color, mode],
    );

    const handlePointerDown = useCallback(
        (event: ReactPointerEvent<HTMLCanvasElement>) => {
            const canvas = canvasRef.current;
            const context = getContext();
            if (!canvas || !context) return;
            event.preventDefault();
            updateBrushCursor(event);
            canvas.setPointerCapture(event.pointerId);
            pushUndo();
            const point = getPoint(event);
            drawingRef.current = { active: true, lastX: point.x, lastY: point.y };
            configureStroke(context);
            context.beginPath();
            context.moveTo(point.x, point.y);
            context.lineTo(point.x + 0.1, point.y + 0.1);
            context.stroke();
            setHasInk(true);
        },
        [configureStroke, getContext, getPoint, pushUndo, updateBrushCursor],
    );

    const handlePointerMove = useCallback(
        (event: ReactPointerEvent<HTMLCanvasElement>) => {
            updateBrushCursor(event);
            if (!drawingRef.current.active) return;
            const context = getContext();
            if (!context) return;
            event.preventDefault();
            const point = getPoint(event);
            configureStroke(context);
            context.beginPath();
            context.moveTo(drawingRef.current.lastX, drawingRef.current.lastY);
            context.lineTo(point.x, point.y);
            context.stroke();
            drawingRef.current = { active: true, lastX: point.x, lastY: point.y };
        },
        [configureStroke, getContext, getPoint, updateBrushCursor],
    );

    const stopDrawing = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current.active) return;
        drawingRef.current.active = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
    }, []);

    const undo = useCallback(() => {
        const canvas = canvasRef.current;
        const context = getContext();
        const previous = undoStackRef.current.pop();
        if (!canvas || !context || !previous) return;
        context.putImageData(previous, 0, 0);
        setUndoDepth(undoStackRef.current.length);
        setHasInk(undoStackRef.current.length > 0);
    }, [getContext]);

    const clear = useCallback(() => {
        pushUndo();
        fillWhite();
        setHasInk(false);
    }, [fillWhite, pushUndo]);

    const hideBrushCursor = useCallback(() => {
        setBrushCursor((current) => ({ ...current, visible: false }));
    }, []);

    const save = useCallback(async () => {
        const canvas = canvasRef.current;
        if (!canvas || !hasInk) return;
        setSaving(true);
        try {
            // 保存前重新合成白底，避免图片节点透出画布网格。
            const output = document.createElement("canvas");
            output.width = canvas.width;
            output.height = canvas.height;
            const context = output.getContext("2d");
            if (!context) throw new Error("画笔图片保存失败");
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, output.width, output.height);
            context.drawImage(canvas, 0, 0);
            await onSave(output.toDataURL("image/png"));
        } finally {
            setSaving(false);
        }
    }, [hasInk, onSave]);

    return (
        <Modal title={null} open={open} centered footer={null} width={1040} onCancel={saving ? undefined : onClose} afterOpenChange={handleOpenChange} destroyOnHidden styles={{ body: { padding: 0 } }}>
            <div className="overflow-hidden rounded-2xl bg-white text-stone-950 shadow-2xl">
                <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
                    <div className="flex items-center gap-2">
                        <span className="grid size-9 place-items-center rounded-xl bg-stone-100 text-stone-700">
                            <Paintbrush className="size-4.5" />
                        </span>
                        <div>
                            <div className="text-sm font-semibold">画笔参考图</div>
                            <div className="text-xs text-stone-500">在白色画布上简单画一下，保存后会生成图片节点</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button icon={<RotateCcw className="size-4" />} disabled={!undoDepth || saving} onClick={undo}>
                            撤销
                        </Button>
                        <Button icon={<Trash2 className="size-4" />} disabled={saving} onClick={clear}>
                            清空
                        </Button>
                    </div>
                </div>

                <div className="bg-stone-100 p-4">
                    <div className="relative overflow-hidden rounded-xl border border-stone-200 bg-white shadow-inner">
                        <canvas
                            ref={canvasRef}
                            width={SKETCH_WIDTH}
                            height={SKETCH_HEIGHT}
                            className="block h-auto w-full touch-none cursor-none select-none bg-white"
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={stopDrawing}
                            onPointerCancel={stopDrawing}
                            onPointerLeave={(event) => {
                                stopDrawing(event);
                                hideBrushCursor();
                            }}
                        />
                        {brushCursor.visible ? (
                            <div
                                className="pointer-events-none absolute rounded-full border shadow-sm"
                                style={{
                                    left: brushCursor.x,
                                    top: brushCursor.y,
                                    width: brushCursor.diameter,
                                    height: brushCursor.diameter,
                                    transform: "translate(-50%, -50%)",
                                    borderColor: mode === "erase" ? "rgba(68,64,60,.65)" : color,
                                    background: mode === "erase" ? "rgba(255,255,255,.55)" : `${color}22`,
                                }}
                            />
                        ) : null}
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-5 py-3">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                        <div className="flex items-center gap-1.5 rounded-xl bg-stone-100 p-1">
                            <ToolButton active={mode === "draw"} onClick={() => setMode("draw")}>
                                <Paintbrush className="size-4" />
                                画笔
                            </ToolButton>
                            <ToolButton active={mode === "erase"} onClick={() => setMode("erase")}>
                                <Eraser className="size-4" />
                                橡皮
                            </ToolButton>
                        </div>
                        <div className="flex items-center gap-2">
                            {COLORS.map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    aria-label={`选择颜色 ${item}`}
                                    className={`size-7 rounded-full border transition ${color === item ? "border-stone-950 ring-2 ring-stone-300" : "border-black/10"}`}
                                    style={{ background: item }}
                                    onClick={() => {
                                        setColor(item);
                                        setMode("draw");
                                    }}
                                />
                            ))}
                        </div>
                        <div className="flex min-w-[220px] items-center gap-3 text-xs text-stone-500">
                            <span>粗细</span>
                            <Slider className="min-w-36 flex-1" min={2} max={28} value={brushSize} onChange={setBrushSize} />
                            <span className="w-8 text-right">{brushSize}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button disabled={saving} onClick={onClose}>
                            取消
                        </Button>
                        <Button type="primary" icon={<Save className="size-4" />} disabled={!hasInk} loading={saving} onClick={save}>
                            保存到画布
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function ToolButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
    return (
        <button type="button" className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm transition ${active ? "bg-stone-950 text-white shadow-sm" : "text-stone-600 hover:bg-white"}`} onClick={onClick}>
            {children}
        </button>
    );
}
