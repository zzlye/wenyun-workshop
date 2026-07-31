import { bench, describe } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { getCanvasViewportBounds, getVisibleCanvasConnections, getVisibleCanvasNodes } from "./canvas-viewport";

function createFixture(nodeCount: number) {
    const columns = Math.ceil(Math.sqrt(nodeCount));
    const nodes: CanvasNodeData[] = Array.from({ length: nodeCount }, (_, index) => ({
        id: `node-${index}`,
        type: index % 5 === 0 ? CanvasNodeType.Video : CanvasNodeType.Image,
        title: `节点 ${index}`,
        position: {
            x: (index % columns) * 340,
            y: Math.floor(index / columns) * 260,
        },
        width: 280,
        height: 200,
    }));
    const connections: CanvasConnection[] = nodes.slice(1).map((node, index) => ({
        id: `connection-${index}`,
        fromNodeId: nodes[index].id,
        toNodeId: node.id,
    }));

    return { nodes, connections, nodeById: new Map(nodes.map((node) => [node.id, node])) };
}

describe("画布可视区域基准", () => {
    for (const nodeCount of [50, 150, 300]) {
        const fixture = createFixture(nodeCount);
        const bounds = getCanvasViewportBounds({ x: -1800, y: -1200, k: 0.8 }, { width: 1440, height: 900 });

        bench(`${nodeCount} 个节点与 ${fixture.connections.length} 条连线`, () => {
            getVisibleCanvasNodes(fixture.nodes, bounds);
            getVisibleCanvasConnections(fixture.connections, fixture.nodeById, bounds);
        });
    }
});
