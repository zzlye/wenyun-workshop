"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "../types";
import { isCanvasEditableTarget } from "../utils/canvas-dom-events";

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    backgroundMode?: CanvasBackgroundMode;
    isPureBackground?: boolean;
    interactionMode?: "select" | "pan";
    onViewportChange: (viewport: ViewportTransform) => void;
    onViewportPreview?: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDoubleClick?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
};

export function InfiniteCanvas({
    containerRef,
    viewport,
    backgroundMode = "lines",
    isPureBackground = false,
    interactionMode = "select",
    onViewportChange,
    onViewportPreview,
    onCanvasMouseDown,
    onCanvasDoubleClick,
    onCanvasDeselect,
    onContextMenu,
    onDrop,
    children,
}: InfiniteCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const panState = useRef({
        isPanning: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
    });
    const lastBackgroundClickRef = useRef<{ time: number; x: number; y: number } | null>(null);
    const scaleRef = useRef(viewport.k);
    const frameRef = useRef<number | null>(null);
    const nextViewportRef = useRef<ViewportTransform | null>(null);
    const viewportRef = useRef(viewport);
    const worldRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const wheelCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onViewportChangeRef = useRef(onViewportChange);
    const onViewportPreviewRef = useRef(onViewportPreview);
    const [isSpacePressed, setIsSpacePressed] = useState(false);

    useLayoutEffect(() => {
        viewportRef.current = viewport;
        scaleRef.current = viewport.k;
        applyViewportStyles(worldRef.current, gridRef.current, viewport, backgroundMode, theme);
    }, [backgroundMode, theme, viewport]);

    useLayoutEffect(() => {
        onViewportChangeRef.current = onViewportChange;
        onViewportPreviewRef.current = onViewportPreview;
    }, [onViewportChange, onViewportPreview]);

    const previewViewport = useCallback(
        (nextViewport: ViewportTransform) => {
            viewportRef.current = nextViewport;
            scaleRef.current = nextViewport.k;
            applyViewportStyles(worldRef.current, gridRef.current, nextViewport, backgroundMode, theme);
            onViewportPreviewRef.current?.(nextViewport);
        },
        [backgroundMode, theme],
    );

    const commitViewport = useCallback(() => {
        if (wheelCommitTimerRef.current) {
            clearTimeout(wheelCommitTimerRef.current);
            wheelCommitTimerRef.current = null;
        }
        onViewportChangeRef.current(viewportRef.current);
    }, []);

    const scheduleViewportCommit = useCallback(() => {
        if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
        wheelCommitTimerRef.current = setTimeout(commitViewport, 90);
    }, [commitViewport]);

    useEffect(
        () => () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
        },
        [],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            if (isCanvasEditableTarget(event.target)) return;
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") setIsSpacePressed(false);
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;

        const currentViewport = viewportRef.current;
        const delta = -event.deltaY;
        const factor = Math.pow(1.1, delta / 100);
        const newScale = Math.min(Math.max(currentViewport.k * factor, 0.05), 5);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const worldX = (mouseX - currentViewport.x) / currentViewport.k;
        const worldY = (mouseY - currentViewport.y) / currentViewport.k;

        previewViewport({
            x: mouseX - worldX * newScale,
            y: mouseY - worldY * newScale,
            k: newScale,
        });
        scheduleViewportCommit();
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom]")) return;
        if (target?.closest("[data-connection-create-menu]")) return;
        if (target?.closest("[data-canvas-node-create-menu]")) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");

        if (event.button === 0 && isBackgroundClick && !event.ctrlKey && !event.metaKey && !isSpacePressed) {
            const now = window.performance.now();
            const lastClick = lastBackgroundClickRef.current;
            const isDoubleClick = lastClick && now - lastClick.time < 360 && Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) < 10;
            lastBackgroundClickRef.current = isDoubleClick ? null : { time: now, x: event.clientX, y: event.clientY };
            if (isDoubleClick) {
                event.preventDefault();
                event.stopPropagation();
                onCanvasDoubleClick?.(event);
                return;
            }
        }

        if (event.button === 0 && isBackgroundClick && (interactionMode === "select" || event.ctrlKey || event.metaKey) && !isSpacePressed) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
            return;
        }

        if (event.button === 1 || (event.button === 0 && isBackgroundClick && (interactionMode === "pan" || isSpacePressed))) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            // 平移开始前先提交滚轮缩放，避免缩放计时器在平移过程中触发整页更新。
            if (wheelCommitTimerRef.current) commitViewport();
            panState.current = {
                isPanning: true,
                startX: event.clientX,
                startY: event.clientY,
                initialX: viewportRef.current.x,
                initialY: viewportRef.current.y,
                hasMoved: false,
            };
            document.body.style.cursor = "grabbing";
            return;
        }

        if (event.button === 0 && isSpacePressed && isBackgroundClick) event.preventDefault();
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (!panState.current.isPanning) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
                lastBackgroundClickRef.current = null;
            }

            nextViewportRef.current = {
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: scaleRef.current,
            };
            if (frameRef.current) return;
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null;
                if (nextViewportRef.current) previewViewport(nextViewportRef.current);
            });
        };

        const handlePointerUp = () => {
            if (!panState.current.isPanning) return;

            if (!panState.current.hasMoved) {
                onCanvasDeselect?.();
            }
            panState.current.isPanning = false;
            document.body.style.cursor = "default";
            commitViewport();
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        };
    }, [commitViewport, onCanvasDeselect, previewViewport]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const preventWheelScroll = (event: WheelEvent) => event.preventDefault();
        container.addEventListener("wheel", preventWheelScroll, { passive: false });
        return () => container.removeEventListener("wheel", preventWheelScroll);
    }, [containerRef]);

    return (
        <div
            ref={containerRef}
            className={`relative h-full w-full select-none overflow-hidden ${interactionMode === "pan" || isSpacePressed ? "cursor-grab" : "cursor-default"}`}
            style={{ background: isPureBackground ? theme.canvas.background : "transparent" }}
            onPointerDown={handlePointerDown}
            onWheel={handleWheel}
            onContextMenu={onContextMenu}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
        >
            {backgroundMode !== "blank" ? <div ref={gridRef} className="pointer-events-none absolute inset-0 opacity-40" style={getCanvasGridStyle(viewport, backgroundMode, theme)} /> : null}
            <div
                ref={worldRef}
                data-canvas-world
                className="absolute origin-top-left"
                style={{
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
                }}
            >
                {children}
            </div>
        </div>
    );
}

function getCanvasGridStyle(viewport: ViewportTransform, mode: CanvasBackgroundMode, theme: (typeof canvasThemes)[keyof typeof canvasThemes]): React.CSSProperties {
    const gridSize = 48 * viewport.k;
    const x = viewport.x % gridSize;
    const y = viewport.y % gridSize;
    const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
    const backgroundImage =
        mode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;

    return {
        backgroundImage,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${x}px ${y}px`,
    };
}

function applyViewportStyles(
    world: HTMLDivElement | null,
    grid: HTMLDivElement | null,
    viewport: ViewportTransform,
    mode: CanvasBackgroundMode,
    theme: (typeof canvasThemes)[keyof typeof canvasThemes],
) {
    if (world) world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`;
    if (grid && mode !== "blank") Object.assign(grid.style, getCanvasGridStyle(viewport, mode, theme));
}
