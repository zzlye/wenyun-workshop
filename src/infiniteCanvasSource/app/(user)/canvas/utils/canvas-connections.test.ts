import { describe, expect, it } from "vitest";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { normalizeConnection } from "./canvas-connections";
import { getConnectionPathGeometry, getVisibleCanvasConnections } from "./canvas-viewport";

const left: CanvasNodeData = { id: "left", type: CanvasNodeType.Image, title: "左", position: { x: 0, y: 0 }, width: 200, height: 160 };
const right: CanvasNodeData = { ...left, id: "right", position: { x: 500, y: 0 } };

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
