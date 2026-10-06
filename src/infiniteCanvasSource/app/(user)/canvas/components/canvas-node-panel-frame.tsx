import { useLayoutEffect, useRef, type ReactNode } from "react";
import { NODE_DEFAULT_SIZE } from "../constants";
import type { CanvasNodeType } from "../types";

/** 面板按节点实际宽度整体缩放；画布变换由共同父层自然继承，不设置屏幕尺寸上下限。 */
export function CanvasNodePanelFrame({ type, children }: { type: CanvasNodeType; children: ReactNode }) {
    const frameRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const frame = frameRef.current;
        const node = frame?.parentElement;
        if (!frame || !node) return;
        const update = () => {
            // 四角拖拽会直接改节点宽度；使用画布内尺寸，避免把画布缩放反向抵消。
            const width = Number.parseFloat(node.style.width);
            if (!Number.isFinite(width) || width <= 0) return;
            const factor = width / NODE_DEFAULT_SIZE[type].width;
            frame.style.transform = `translateX(-50%) scale(${factor})`;
            frame.style.top = `calc(100% + ${12 * factor}px)`;
        };
        update();
        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(node);
        // 同步拖拽预览与外部尺寸恢复，无需改写节点数据或依赖鼠标松手后的重新渲染。
        const sizeObserver = new MutationObserver(update);
        sizeObserver.observe(node, { attributes: true, attributeFilter: ["style"] });
        return () => {
            resizeObserver.disconnect();
            sizeObserver.disconnect();
        };
    }, [type]);

    return <div ref={frameRef} data-canvas-panel-frame className="absolute left-1/2 top-full z-[70] w-[640px] origin-top">{children}</div>;
}
