import { describe, expect, it } from "vitest";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type SelectionBox } from "../types";
import { connectionIntersectsBox, getCanvasBoxSelection } from "./canvas-selection";
import { getConnectionPathGeometry } from "./canvas-viewport";

const node = (id: string, x: number, y: number): CanvasNodeData => ({ id, title: id, type: CanvasNodeType.Image, position: { x, y }, width: 100, height: 120 });
const nodes = [node("a", 0, 0), node("b", 600, 0), node("c", 0, 360), node("d", 600, 360)];
const connections: CanvasConnection[] = [{ id: "ab", fromNodeId: "a", toNodeId: "b" }, { id: "cd", fromNodeId: "c", toNodeId: "d" }];
const box = (x1: number, y1: number, x2: number, y2: number): SelectionBox => ({
    startWorldX: x1, startWorldY: y1, currentWorldX: x2, currentWorldY: y2, additive: false, initialSelectedNodeIds: [], initialSelectedConnectionIds: [],
});

describe("连线框选", () => {
    it("曲线穿过框选区域时只选中线，不要求节点在框内", () => {
        const result = getCanvasBoxSelection(nodes, connections, box(250, 50, 350, 70));
        expect([...result.nodeIds]).toEqual([]);
        expect([...result.connectionIds]).toEqual(["ab"]);
    });

    it("可以反向框选多条线", () => {
        const result = getCanvasBoxSelection(nodes, connections, box(350, 450, 250, 40));
        expect([...result.nodeIds]).toEqual([]);
        expect([...result.connectionIds]).toEqual(["ab", "cd"]);
    });

    it("曲线包围盒内的空白不算选中", () => {
        const geometry = getConnectionPathGeometry(nodes[0], nodes[3]);
        expect(connectionIntersectsBox(geometry, { left: 150, top: 340, right: 250, bottom: 390 })).toBe(false);
        expect(connectionIntersectsBox(geometry, { left: 349, top: 239, right: 351, bottom: 241 })).toBe(true);
    });

    it("同侧弯曲连线超出端点范围的部分也能被选中", () => {
        const geometry = getConnectionPathGeometry(nodes[0], nodes[3], { fromSide: "right", toSide: "right" });
        expect(connectionIntersectsBox(geometry, { left: 770, top: 360, right: 780, bottom: 367 })).toBe(true);
        expect(connectionIntersectsBox(geometry, { left: 960, top: 100, right: 980, bottom: 120 })).toBe(false);
    });

    it("反向连接沿实际曲线判断", () => {
        const geometry = getConnectionPathGeometry(nodes[3], nodes[0], { fromSide: "left", toSide: "right" });
        expect(connectionIntersectsBox(geometry, { left: 349, top: 239, right: 351, bottom: 241 })).toBe(true);
    });

    it.each([0.2, 0.5, 1, 2, 4])("缩放 %s 时使用一致的世界坐标选中结果", (scale) => {
        expect([...getCanvasBoxSelection(nodes, connections, box(250, 50, 350, 70), scale).connectionIds]).toEqual(["ab"]);
    });

    it("Shift追加节点和线，收缩框选不保留临时经过的线", () => {
        const selection = { ...box(250, 40, 350, 450), additive: true, initialSelectedNodeIds: ["a"], initialSelectedConnectionIds: ["ab"] };
        expect([...getCanvasBoxSelection(nodes, connections, selection).connectionIds]).toEqual(["ab", "cd"]);
        const shrunk = getCanvasBoxSelection(nodes, connections, { ...selection, currentWorldY: 100 });
        expect([...shrunk.connectionIds]).toEqual(["ab"]);
        expect([...shrunk.nodeIds]).toEqual(["a"]);
    });

    it("普通框选替换之前选择，支持节点和独立连线同时命中", () => {
        const result = getCanvasBoxSelection(nodes, connections, { ...box(0, 40, 350, 450), initialSelectedNodeIds: ["b"], initialSelectedConnectionIds: ["old"] });
        expect([...result.nodeIds]).toEqual(["a", "c"]);
        expect([...result.connectionIds]).toEqual(["ab", "cd"]);
    });

    it("隐藏端点和悬空连线不被框选", () => {
        const result = getCanvasBoxSelection(nodes, [...connections, { id: "missing", fromNodeId: "a", toNodeId: "missing" }], box(-10, -10, 800, 500), 1, n => n.id === "c");
        expect([...result.connectionIds]).toEqual(["ab"]);
        expect([...result.nodeIds]).toEqual(["a", "b", "d"]);
    });

    it("未拖动时不把点击位置附近的线自动加入选择", () => {
        expect(getCanvasBoxSelection(nodes, connections, box(350, 60, 350, 60)).connectionIds.size).toBe(0);
    });
});
