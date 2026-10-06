import { useLayoutEffect, useRef, type ReactNode } from "react";
import { NODE_DEFAULT_SIZE } from "../constants";
import type { CanvasNodeType } from "../types";

const PANEL_WIDTH = 640;
const MIN_SCREEN_WIDTH = 520;
const MAX_SCREEN_WIDTH = 960;

/** 保留面板原始布局，随节点整体缩放，避免只拉宽外框却把文字留在缩小的画布比例下。 */
export function CanvasNodePanelFrame({ type, scale, children }: { type: CanvasNodeType; scale: number; children: ReactNode }) {
    const frameRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const frame = frameRef.current;
        const node = frame?.parentElement;
        if (!frame || !node) return;
        const world = node.closest<HTMLElement>("[data-canvas-world]");
        const viewport = world?.parentElement;
        const update = () => {
            // 拖拽直接改节点 DOM，滚轮直接改世界层变换；读取实际几何即可同步，无需每帧更新节点状态。
            const nodeRect = node.getBoundingClientRect();
            const worldScale = world ? new DOMMatrixReadOnly(getComputedStyle(world).transform).a : scale;
            if (!Number.isFinite(worldScale) || worldScale <= 0) return;
            const viewportRect = viewport?.getBoundingClientRect();
            const left = Math.max(0, viewportRect?.left || 0) + 12;
            const right = Math.min(window.innerWidth, viewportRect?.right ?? window.innerWidth) - 12;
            const available = Math.max(1, right - left);
            const naturalWidth = nodeRect.width * PANEL_WIDTH / NODE_DEFAULT_SIZE[type].width;
            const screenWidth = Math.min(available, MAX_SCREEN_WIDTH, Math.max(MIN_SCREEN_WIDTH, naturalWidth));
            const factor = screenWidth / PANEL_WIDTH / worldScale;
            // 靠近屏幕边缘时挪回可视区，避免生成按钮随大节点移到窗口外。
            const center = Math.min(right - screenWidth / 2, Math.max(left + screenWidth / 2, nodeRect.left + nodeRect.width / 2));
            frame.style.left = `${(center - nodeRect.left) / worldScale}px`;
            frame.style.transform = `translateX(-50%) scale(${factor})`;
            frame.style.top = `calc(100% + ${12 / worldScale}px)`;
        };
        update();
        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(node);
        if (viewport) resizeObserver.observe(viewport);
        // 画布缩放预览发生在 React 提交之前，观察样式可避免松开滚轮后才恢复字号。
        const transformObserver = new MutationObserver(update);
        if (world) transformObserver.observe(world, { attributes: true, attributeFilter: ["style"] });
        transformObserver.observe(node, { attributes: true, attributeFilter: ["style"] });
        window.addEventListener("resize", update);
        return () => {
            resizeObserver.disconnect();
            transformObserver.disconnect();
            window.removeEventListener("resize", update);
        };
    }, [scale, type]);

    return <div ref={frameRef} data-canvas-panel-frame className="absolute left-1/2 top-full z-[70] w-[640px] origin-top">{children}</div>;
}
