import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { CanvasNodeType, type CanvasNodeData, type Position } from "../types";

export type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type Geometry = { width: number; height: number; position: Position };
type ResizeCallback = (nodeId: string, width: number, height: number, position: Position) => void;
export type NodeResizeCallbacks = {
    onResize: ResizeCallback;
    onResizeStart?: (nodeId: string) => void;
    onResizePreview?: ResizeCallback;
    onResizeEnd?: () => void;
};

export function useCanvasNodeResize(data: CanvasNodeData, scale: number, callbacks: NodeResizeCallbacks) {
    const elementRef = useRef<HTMLDivElement>(null);
    const latest = useRef({ data, scale, callbacks });
    const frame = useRef<number | null>(null);
    const session = useRef<{
        node: CanvasNodeData; scale: number; corner: ResizeCorner; x: number; y: number; pending: Geometry;
    } | null>(null);

    const paint = useCallback(() => {
        frame.current = null;
        const current = session.current;
        const element = elementRef.current;
        if (!current || !element) return;
        const { width, height, position } = current.pending;
        // 拖动仅更新视觉，不反复写入项目、撤销栈和弹层组件的 React 状态。
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
        element.style.transform = `translate(${position.x}px, ${position.y}px)`;
        latest.current.callbacks.onResizePreview?.(current.node.id, width, height, position);
    }, []);

    useLayoutEffect(() => {
        latest.current = { data, scale, callbacks };
        // 异步生成结果等外部更新可以继续渲染，缩放中的预览位置仍保持不变。
        if (session.current) {
            if (frame.current !== null) cancelAnimationFrame(frame.current);
            paint();
        }
    });

    useEffect(() => {
        const finish = () => {
            const current = session.current;
            if (!current) return;
            if (frame.current !== null) cancelAnimationFrame(frame.current);
            paint();
            session.current = null;
            const { node, pending } = current;
            const changed = node.width !== pending.width || node.height !== pending.height || node.position.x !== pending.position.x || node.position.y !== pending.position.y;
            // 松手或切出窗口都结束同一次操作，只保存最后一个尺寸。
            if (changed) latest.current.callbacks.onResize(node.id, pending.width, pending.height, pending.position);
            latest.current.callbacks.onResizeEnd?.();
        };
        const move = (event: MouseEvent) => {
            const current = session.current;
            if (!current) return;
            if (event.buttons === 0) { finish(); return; }
            const { node, corner } = current;
            const dx = (event.clientX - current.x) / current.scale;
            const dy = (event.clientY - current.y) / current.scale;
            const fromLeft = corner.endsWith("left");
            const fromTop = corner.startsWith("top");
            const minWidth = 220;
            const minHeight = 160;
            let width = Math.max(minWidth, node.width + (fromLeft ? -dx : dx));
            let height = Math.max(minHeight, node.height + (fromTop ? -dy : dy));
            if ((node.type === CanvasNodeType.Image && !node.metadata?.freeResize) || node.type === CanvasNodeType.Video) {
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                if (Math.abs(dx) >= Math.abs(dy)) height = width / ratio;
                else width = height * ratio;
                if (height < minHeight) { height = minHeight; width = height * ratio; }
                if (width < minWidth) { width = minWidth; height = width / ratio; }
            }
            current.pending = {
                width, height,
                position: {
                    x: fromLeft ? node.position.x + node.width - width : node.position.x,
                    y: fromTop ? node.position.y + node.height - height : node.position.y,
                },
            };
            if (frame.current === null) frame.current = requestAnimationFrame(paint);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", finish);
        window.addEventListener("blur", finish);
        window.addEventListener("pointercancel", finish);
        return () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", finish);
            window.removeEventListener("blur", finish);
            window.removeEventListener("pointercancel", finish);
            if (frame.current !== null) cancelAnimationFrame(frame.current);
            if (session.current) latest.current.callbacks.onResizeEnd?.();
            session.current = null;
        };
    }, [paint]);

    const start = useCallback((event: ReactMouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        if (event.button !== 0) return;
        const { data: node, scale: currentScale } = latest.current;
        session.current = {
            node, scale: currentScale, corner, x: event.clientX, y: event.clientY,
            pending: { width: node.width, height: node.height, position: node.position },
        };
        latest.current.callbacks.onResizeStart?.(node.id);
    }, []);
    return { elementRef, start };
}
