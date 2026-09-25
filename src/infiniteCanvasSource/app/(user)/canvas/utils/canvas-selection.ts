import type { CanvasConnection, CanvasNodeData, Position, SelectionBox } from "../types";
import { getConnectionPathGeometry, type CanvasWorldBounds, type ConnectionPathGeometry } from "./canvas-viewport";

const midpoint = (a: Position, b: Position): Position => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// 逐段细分贝塞尔曲线，控制点包围盒只作粗筛，不能直接当作曲线命中区域。
export function connectionIntersectsBox(geometry: ConnectionPathGeometry, box: CanvasWorldBounds, tolerance = 0.25): boolean {
    const inside = (p: Position) => p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
    const visit = (a: Position, b: Position, c: Position, d: Position, depth: number): boolean => {
        const left = Math.min(a.x, b.x, c.x, d.x);
        const right = Math.max(a.x, b.x, c.x, d.x);
        const top = Math.min(a.y, b.y, c.y, d.y);
        const bottom = Math.max(a.y, b.y, c.y, d.y);
        if (right < box.left || left > box.right || bottom < box.top || top > box.bottom) return false;
        if (inside(a) || inside(d)) return true;
        // 误差限制在屏幕亚像素内；深度上限保护异常或极端坐标。
        if (Math.max(right - left, bottom - top) <= tolerance || depth >= 24) return true;
        const ab = midpoint(a, b);
        const bc = midpoint(b, c);
        const cd = midpoint(c, d);
        const abc = midpoint(ab, bc);
        const bcd = midpoint(bc, cd);
        const center = midpoint(abc, bcd);
        return visit(a, ab, abc, center, depth + 1) || visit(center, bcd, cd, d, depth + 1);
    };
    return visit(geometry.start, geometry.controlStart, geometry.controlEnd, geometry.end, 0);
}

export function getCanvasBoxSelection(
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    selection: SelectionBox,
    scale = 1,
    isHiddenNode: (node: CanvasNodeData) => boolean = () => false,
    isHiddenEndpoint: (node: CanvasNodeData) => boolean = isHiddenNode,
) {
    const box = {
        left: Math.min(selection.startWorldX, selection.currentWorldX),
        top: Math.min(selection.startWorldY, selection.currentWorldY),
        right: Math.max(selection.startWorldX, selection.currentWorldX),
        bottom: Math.max(selection.startWorldY, selection.currentWorldY),
    };
    // 每次从按下鼠标时的快照计算，缩小选框时移除已离开选框的对象。
    const nodeIds = new Set(selection.additive ? selection.initialSelectedNodeIds : []);
    const connectionIds = new Set(selection.additive ? selection.initialSelectedConnectionIds : []);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    if (box.right === box.left || box.bottom === box.top) return { nodeIds, connectionIds };
    for (const node of nodes) {
        if (!isHiddenNode(node) && box.left < node.position.x + node.width && box.right > node.position.x && box.top < node.position.y + node.height && box.bottom > node.position.y) nodeIds.add(node.id);
    }
    for (const connection of connections) {
        const from = nodeById.get(connection.fromNodeId);
        const to = nodeById.get(connection.toNodeId);
        if (!from || !to || isHiddenEndpoint(from) || isHiddenEndpoint(to)) continue;
        if (connectionIntersectsBox(getConnectionPathGeometry(from, to, connection), box, 0.25 / Math.max(scale, 0.0001))) connectionIds.add(connection.id);
    }
    return { nodeIds, connectionIds };
}
