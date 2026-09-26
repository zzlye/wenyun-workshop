import type { CanvasGroupLayout, CanvasNodeData, Position } from "../types";

/** 计算多选节点的整理位置，不修改传入节点，便于组和普通多选共用。 */
export function getCanvasNodeLayoutPositions(nodes: CanvasNodeData[], layout: CanvasGroupLayout, gap = 36): Map<string, Position> {
    if (layout === "free" || !nodes.length) return new Map();

    const minLeft = Math.min(...nodes.map((node) => node.position.x));
    const minTop = Math.min(...nodes.map((node) => node.position.y));
    const sortedNodes = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    const nextPositionById = new Map<string, Position>();

    if (layout === "horizontal") {
        let x = minLeft;
        sortedNodes.forEach((node) => {
            nextPositionById.set(node.id, { x, y: minTop });
            x += node.width + gap;
        });
        return nextPositionById;
    }

    if (layout === "vertical") {
        let y = minTop;
        sortedNodes.forEach((node) => {
            nextPositionById.set(node.id, { x: minLeft, y });
            y += node.height + gap;
        });
        return nextPositionById;
    }

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
    return nextPositionById;
}
