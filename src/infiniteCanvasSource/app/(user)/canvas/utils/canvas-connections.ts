import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ConnectionHandle, type ConnectionSide } from "../types";

export function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: ConnectionHandle["handleType"], secondSide?: ConnectionSide): Omit<CanvasConnection, "id"> | null {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    const firstSide = firstHandleType === "source" ? "right" : "left";
    // 拖到节点内部或新建节点时选择靠近起点的一侧，明确选择的端点优先。
    const startX = first.position.x + (firstSide === "right" ? first.width : 0);
    const targetSide = second.type === CanvasNodeType.Config ? "left" : secondSide ?? (startX <= second.position.x + second.width / 2 ? "left" : "right");
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") {
        return { fromNodeId: second.id, toNodeId: first.id, fromSide: targetSide, toSide: firstSide };
    }
    return { fromNodeId: first.id, toNodeId: second.id, fromSide: firstSide, toSide: targetSide };
}
