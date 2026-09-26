import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { getCanvasNodeLayoutPositions } from "./canvas-layout";

const node = (id: string, x: number, y: number, width = 100, height = 60): CanvasNodeData => ({
    id,
    type: CanvasNodeType.Image,
    title: id,
    position: { x, y },
    width,
    height,
});

describe("画布批量整理", () => {
    it("按宫格整理多选节点并保留原节点对象位置", () => {
        const nodes = [node("c", 320, 80), node("a", 40, 200), node("b", 180, 20)];
        const positions = getCanvasNodeLayoutPositions(nodes, "grid");

        expect([...positions.entries()]).toEqual([
            ["b", { x: 40, y: 20 }],
            ["c", { x: 176, y: 20 }],
            ["a", { x: 40, y: 116 }],
        ]);
        expect(nodes.map((item) => item.position)).toEqual([{ x: 320, y: 80 }, { x: 40, y: 200 }, { x: 180, y: 20 }]);
    });

    it("支持水平、垂直整理并忽略自由布局", () => {
        const nodes = [node("a", 100, 200), node("b", 40, 20, 120, 80)];

        expect([...getCanvasNodeLayoutPositions(nodes, "horizontal").values()]).toEqual([{ x: 40, y: 20 }, { x: 196, y: 20 }]);
        expect([...getCanvasNodeLayoutPositions(nodes, "vertical").values()]).toEqual([{ x: 40, y: 20 }, { x: 40, y: 136 }]);
        expect(getCanvasNodeLayoutPositions(nodes, "free")).toEqual(new Map());
    });
});
