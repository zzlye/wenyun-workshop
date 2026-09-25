import { describe, expect, it } from "vitest";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { buildSelectionConnections, getConnectionSourceIds, mergeCanvasConnections, normalizeConnection } from "./canvas-connections";
import { getConnectionPathGeometry, getVisibleCanvasConnections } from "./canvas-viewport";

const left: CanvasNodeData = { id: "left", type: CanvasNodeType.Image, title: "左", position: { x: 0, y: 0 }, width: 200, height: 160 };
const right: CanvasNodeData = { ...left, id: "right", position: { x: 500, y: 0 } };

describe("多选节点批量连接", () => {
    const sources = [left, { ...left, id: "second", position: { x: 0, y: 250 } }, { ...left, id: "third", position: { x: 0, y: 500 } }];
    const nodes = [...sources, right];
    const handle = { nodeId: "left", nodeIds: sources.map((node) => node.id), handleType: "source" as const };

    it("三个选中起点一次接到同一目标并保留输入顺序", () => {
        const edges = buildSelectionConnections(handle, right.id, nodes, "left");
        expect(edges).toEqual(sources.map((node) => ({ fromNodeId: node.id, toNodeId: right.id, fromSide: "right", toSide: "left" })));
    });

    it("从左侧端点批量连到右侧端点时保留明确选择的端点", () => {
        const edges = buildSelectionConnections({ ...handle, handleType: "target" }, right.id, nodes, "right");
        expect(edges.every((edge) => edge.fromSide === "left" && edge.toSide === "right")).toBe(true);
        expect(edges).toHaveLength(3);
    });

    it("重复拖线不重复引用，已有连线更新端点且保留编号", () => {
        let sequence = 0;
        const createId = () => String(++sequence);
        const additions = buildSelectionConnections(handle, right.id, nodes, "left");
        const existing = [{ id: "old", ...additions[0], fromSide: "left" as const }];
        const merged = mergeCanvasConnections(existing, additions, createId);
        expect(merged).toHaveLength(3);
        expect(merged[0]).toEqual({ id: "old", ...additions[0] });
        expect(sequence).toBe(2);
        expect(mergeCanvasConnections(merged, additions, createId)).toBe(merged);
    });

    it("新建目标也使用完整起点快照，忽略重复和已删除的起点", () => {
        const frozen = { ...handle, nodeIds: ["left", "second", "third", "left", "deleted"] };
        const newTarget = { ...right, id: "new-target" };
        const edges = buildSelectionConnections(frozen, newTarget.id, [...nodes, newTarget]);
        expect(edges).toHaveLength(3);
        expect(edges.every((edge) => edge.toNodeId === newTarget.id)).toBe(true);
    });

    it("释放到选中的起点上不会产生组内误连接或自连接", () => {
        expect(buildSelectionConnections(handle, "second", nodes)).toEqual([]);
        expect(buildSelectionConnections({ nodeId: left.id, handleType: "source" }, left.id, nodes)).toEqual([]);
    });

    it("单选与旧配置节点保留既有方向规则", () => {
        expect(getConnectionSourceIds({ nodeId: left.id, handleType: "source" })).toEqual([left.id]);
        const config = { ...left, type: CanvasNodeType.Config };
        expect(buildSelectionConnections({ nodeId: config.id, handleType: "target" }, right.id, [config, right])).toMatchObject([{ fromNodeId: right.id, toNodeId: config.id }]);
    });
});

describe("画布连接端点", () => {
    it("从右侧节点左端拖到左侧节点右端后，保存和重载仍使用相邻端点", () => {
        const saved = JSON.parse(JSON.stringify(normalizeConnection(right.id, left.id, [left, right], "target", "right")));
        expect(saved).toEqual({ fromNodeId: "right", toNodeId: "left", fromSide: "left", toSide: "right" });
        expect(getConnectionPathGeometry(right, left, saved).path).toBe("M 500 80 C 350 80, 350 80, 200 80");
    });

    it.each(["left", "right"] as const)("保留明确选择的同侧 %s 端点，移动节点后也不翻面", side => {
        const edge = { fromSide: side, toSide: side };
        const moved = { ...right, position: { x: -500, y: 100 } };
        const geometry = getConnectionPathGeometry(left, moved, edge);
        expect(geometry.start.x).toBe(side === "left" ? 0 : 200);
        expect(geometry.end.x).toBe(side === "left" ? -500 : -300);
    });

    it("旧连线没有端点信息时使用相邻侧", () => {
        expect(getConnectionPathGeometry(right, left).path).toBe("M 500 80 C 350 80, 350 80, 200 80");
        expect(getConnectionPathGeometry(left, right).path).toBe("M 200 80 C 350 80, 350 80, 500 80");
    });

    it("配置节点交换数据方向时，物理端点随节点一起交换", () => {
        const config = { ...right, type: CanvasNodeType.Config };
        expect(normalizeConnection(config.id, left.id, [left, config], "target", "right")).toEqual({ fromNodeId: "left", toNodeId: "right", fromSide: "right", toSide: "left" });
        expect(normalizeConnection(config.id, "other", [config, { ...config, id: "other" }], "target")).toBeNull();
    });

    it("视口裁剪根据所选端点的曲线判断，不丢掉同侧弯曲线", () => {
        const nodes = [left, { ...right, position: { x: 0, y: 300 } }];
        const connection = { id: "edge", fromNodeId: "left", toNodeId: "right", fromSide: "left" as const, toSide: "left" as const };
        expect(getVisibleCanvasConnections([connection], new Map(nodes.map(n => [n.id, n])), { left: -70, right: -35, top: 0, bottom: 500 })).toEqual([connection]);
    });
});
