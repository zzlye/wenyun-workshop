import { describe, expect, it } from "vitest";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { alignCanvasNodeDrag } from "./canvas-alignment";

const node = (id: string, x: number, y: number, width = 180, height = 120): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x, y }, width, height });

describe("画布拖动对齐", () => {
    it("靠近另一节点上边缘时吸附，并让虚线跨过两个节点", () => {
        const result = alignCanvasNodeDrag([node("moving", 0, 0)], [node("target", 600, 185, 240, 160)], { x: 200, y: 182 }, 1);
        expect(result.delta).toEqual({ x: 200, y: 185 });
        expect(result.guides).toEqual([{ axis: "y", position: 185, start: 184, end: 856 }]);
    });

    it.each([0.25, 1, 2])("缩放 %s 时统一使用六个屏幕像素的吸附距离", (scale) => {
        // 拉开各锚点，单独验证阈值，避免小缩放时吸附到另一条合法中心线。
        const moving = [node("moving", 0, 0, 180, 400)];
        const target = [node("target", 600, 185, 240, 400)];
        expect(alignCanvasNodeDrag(moving, target, { x: 200, y: 185 - 5 / scale }, scale).delta.y).toBe(185);
        expect(alignCanvasNodeDrag(moving, target, { x: 200, y: 185 - 7 / scale }, scale).delta.y).toBe(185 - 7 / scale);
    });

    it("同时对齐横纵中心线，兼容不同节点尺寸", () => {
        const result = alignCanvasNodeDrag([node("moving", 0, 0, 100, 60)], [node("target", 300, 200, 200, 100)], { x: 348, y: 223 }, 1);
        expect(result.delta).toEqual({ x: 350, y: 220 });
        expect(result.guides.map((line) => [line.axis, line.position])).toEqual([["x", 400], ["y", 250]]);
    });

    it("多选按整体边界吸附，传入的节点位置不被改写", () => {
        const moving = [node("a", 0, 0), node("b", 0, 180), node("c", 0, 360)];
        const result = alignCanvasNodeDrag(moving, [node("target", 600, 185, 240, 160)], { x: 200, y: 182 }, 1);
        expect(result.delta).toEqual({ x: 200, y: 185 });
        expect(moving.map((item) => item.position.y)).toEqual([0, 180, 360]);
        expect(result.guides[0].end).toBe(856);
    });

    it("排除移动节点自身，远离其他节点时不吸附", () => {
        const moving = node("a", 0, 0);
        expect(alignCanvasNodeDrag([moving], [moving], { x: 3, y: 4 }, 1)).toEqual({ delta: { x: 3, y: 4 }, guides: [] });
        expect(alignCanvasNodeDrag([moving], [node("far", 900, 900)], { x: 3, y: 4 }, 1).guides).toEqual([]);
    });

    it("多个候选锚点时只选择距离最近的参考线", () => {
        const result = alignCanvasNodeDrag([node("moving", 0, 0)], [node("far", 600, 185), node("near", 900, 183)], { x: 200, y: 182 }, 1);
        expect(result.delta.y).toBe(183);
        expect(result.guides).toHaveLength(1);
    });

    it("按住Alt可精细自由移动，空选择不产生辅助线", () => {
        const delta = { x: 200, y: 182 };
        expect(alignCanvasNodeDrag([node("a", 0, 0)], [node("target", 600, 185)], delta, 1, true)).toEqual({ delta, guides: [] });
        expect(alignCanvasNodeDrag([], [node("target", 600, 185)], delta, 1)).toEqual({ delta, guides: [] });
    });
});
