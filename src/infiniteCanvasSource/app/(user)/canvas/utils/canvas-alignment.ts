import type { CanvasNodeData, Position } from "../types";

export type CanvasAlignmentGuide = { axis: "x" | "y"; position: number; start: number; end: number };
type Bounds = { x: number; y: number; width: number; height: number };

function getBounds(nodes: CanvasNodeData[]): Bounds {
    const x = Math.min(...nodes.map((node) => node.position.x));
    const y = Math.min(...nodes.map((node) => node.position.y));
    return {
        x, y,
        width: Math.max(...nodes.map((node) => node.position.x + node.width)) - x,
        height: Math.max(...nodes.map((node) => node.position.y + node.height)) - y,
    };
}

/** 多选按整体边界吸附，所有节点使用同一偏移，保持原来的相对位置。 */
export function alignCanvasNodeDrag(movingNodes: CanvasNodeData[], otherNodes: CanvasNodeData[], delta: Position, scale: number, disabled = false): { delta: Position; guides: CanvasAlignmentGuide[] } {
    if (disabled || !movingNodes.length) return { delta, guides: [] };
    const movingIds = new Set(movingNodes.map((node) => node.id));
    const candidates = otherNodes.filter((node) => !movingIds.has(node.id));
    const bounds = getBounds(movingNodes);
    // 吸附距离按屏幕像素计算，缩放后手感一致；每次从原始鼠标偏移计算，避免累积漂移。
    const threshold = 6 / Math.max(scale, 0.01);
    const match = (axis: "x" | "y") => {
        const size = axis === "x" ? "width" : "height";
        const anchors = [0, 0.5, 1].map((ratio) => bounds[axis] + bounds[size] * ratio + delta[axis]);
        let best: { offset: number; position: number; node: CanvasNodeData } | null = null;
        for (const node of candidates) {
            for (const ratio of [0, 0.5, 1]) {
                const position = node.position[axis] + node[size] * ratio;
                for (const anchor of anchors) {
                    const offset = position - anchor;
                    if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { offset, position, node };
                }
            }
        }
        return best;
    };
    const x = match("x");
    const y = match("y");
    const snapped = { x: delta.x + (x?.offset ?? 0), y: delta.y + (y?.offset ?? 0) };
    const padding = 16 / Math.max(scale, 0.01);
    const guides: CanvasAlignmentGuide[] = [];
    if (x) guides.push({ axis: "x", position: x.position, start: Math.min(bounds.y + snapped.y, x.node.position.y) - padding, end: Math.max(bounds.y + snapped.y + bounds.height, x.node.position.y + x.node.height) + padding });
    if (y) guides.push({ axis: "y", position: y.position, start: Math.min(bounds.x + snapped.x, y.node.position.x) - padding, end: Math.max(bounds.x + snapped.x + bounds.width, y.node.position.x + y.node.width) + padding });
    return { delta: snapped, guides };
}

/** 只更新两条辅助线的属性，不让整张画布在每次鼠标移动时重新渲染。 */
export function updateCanvasAlignmentGuides(svg: SVGSVGElement | null, guides: CanvasAlignmentGuide[]) {
    if (!svg) return;
    for (const line of svg.querySelectorAll("line")) {
        const guide = guides.find((item) => item.axis === line.dataset.axis);
        line.setAttribute("visibility", guide ? "visible" : "hidden");
        if (!guide) continue;
        line.setAttribute("x1", String(guide.axis === "x" ? guide.position : guide.start));
        line.setAttribute("x2", String(guide.axis === "x" ? guide.position : guide.end));
        line.setAttribute("y1", String(guide.axis === "y" ? guide.position : guide.start));
        line.setAttribute("y2", String(guide.axis === "y" ? guide.position : guide.end));
    }
}
