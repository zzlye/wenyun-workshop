import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ConnectionHandle, type ConnectionSide } from "../types";

export function getConnectionSourceIds(handle: ConnectionHandle): string[] {
    return Array.from(new Set(handle.nodeIds?.length ? handle.nodeIds : [handle.nodeId]));
}

/** 一次拖线生成一组连接，沿用原有端点方向规则，并排除自连接。 */
export function buildSelectionConnections(handle: ConnectionHandle, targetNodeId: string, nodes: CanvasNodeData[], targetSide?: ConnectionSide): Omit<CanvasConnection, "id">[] {
    const sources = getConnectionSourceIds(handle);
    if (sources.includes(targetNodeId)) return [];
    return sources.flatMap((sourceId) => {
        const connection = normalizeConnection(sourceId, targetNodeId, nodes, handle.handleType, targetSide);
        return connection ? [connection] : [];
    });
}

/** 已存在的引用只更新所选端点，整批连接只提交一次并保留原来的顺序与编号。 */
export function mergeCanvasConnections(existing: CanvasConnection[], additions: Omit<CanvasConnection, "id">[], createId: () => string): CanvasConnection[] {
    const result = [...existing];
    const key = (edge: Omit<CanvasConnection, "id">) => JSON.stringify([edge.fromNodeId, edge.toNodeId]);
    const indexByPair = new Map(result.map((edge, index) => [key(edge), index]));
    let changed = false;
    for (const edge of additions) {
        const index = indexByPair.get(key(edge));
        if (index === undefined) {
            indexByPair.set(key(edge), result.length);
            result.push({ id: createId(), ...edge });
            changed = true;
        } else if (result[index].fromSide !== edge.fromSide || result[index].toSide !== edge.toSide) {
            result[index] = { ...result[index], ...edge };
            changed = true;
        }
    }
    return changed ? result : existing;
}

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
