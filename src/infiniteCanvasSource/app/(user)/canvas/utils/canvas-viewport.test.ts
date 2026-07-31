import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { getCanvasViewportBounds, getVisibleCanvasConnections, getVisibleCanvasNodes, isCanvasConnectionVisible } from "./canvas-viewport";

function createNode(id: string, x: number, y: number, width = 200, height = 160): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x, y },
        width,
        height,
    };
}

describe("画布可视区域计算", () => {
    it("根据视口缩放计算世界坐标边界", () => {
        expect(getCanvasViewportBounds({ x: -200, y: -100, k: 2 }, { width: 1000, height: 600 }, 0)).toEqual({
            left: 100,
            top: 50,
            right: 600,
            bottom: 350,
        });
    });

    it("只返回可见且未隐藏的节点", () => {
        const visible = createNode("visible", 100, 100);
        const hidden = createNode("hidden", 200, 200);
        const outside = createNode("outside", 2000, 2000);
        const result = getVisibleCanvasNodes([visible, hidden, outside], { left: 0, top: 0, right: 800, bottom: 600 }, (node) => node.id === "hidden");

        expect(result.map((node) => node.id)).toEqual(["visible"]);
    });

    it("保留两端在视口外但路径穿过视口的连线", () => {
        const from = createNode("from", -500, 200, 100, 100);
        const to = createNode("to", 900, 200, 100, 100);

        expect(isCanvasConnectionVisible(from, to, { left: 0, top: 0, right: 800, bottom: 600 })).toBe(true);
    });

    it("过滤完全位于视口外或端点隐藏的连线", () => {
        const nodes = [createNode("a", 1200, 1200), createNode("b", 1600, 1400), createNode("c", 100, 100)];
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const connections: CanvasConnection[] = [
            { id: "outside", fromNodeId: "a", toNodeId: "b" },
            { id: "hidden", fromNodeId: "c", toNodeId: "a" },
        ];
        const result = getVisibleCanvasConnections(connections, nodeById, { left: 0, top: 0, right: 800, bottom: 600 }, (node) => node.id === "c");

        expect(result).toEqual([]);
    });
});
