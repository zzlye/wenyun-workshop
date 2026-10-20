import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ image: vi.fn(), media: vi.fn(), upload: vi.fn() }));
vi.mock("@/services/image-storage", () => ({ resolveImageUrl: mocks.image, uploadImage: mocks.upload }));
vi.mock("@/services/file-storage", () => ({ resolveMediaUrl: mocks.media }));
import { hydrateCanvasImages, hasCanvasGenerationUpdate, reconcileHydratedCanvasNodes } from "./canvas-media-hydration";
import { CanvasNodeType, type CanvasNodeData } from "../types";

describe("大画布媒体恢复", () => {
    it("1000 个存储图片节点不提前读取原图并保留全部对象引用", async () => {
        const nodes: CanvasNodeData[] = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), title: "图片", type: CanvasNodeType.Image, position: {x:i * 300,y:0}, width:280, height:200, metadata: {storageKey:`image:${i}`,content:""} }));
        expect(await hydrateCanvasImages(nodes)).toBe(nodes);
        expect(mocks.image).not.toHaveBeenCalled();
        expect(mocks.upload).not.toHaveBeenCalled();
        expect(hasCanvasGenerationUpdate(nodes, nodes, new Set(["999"]))).toBe(true);
        expect(hasCanvasGenerationUpdate(nodes, nodes, new Set())).toBe(false);
    });
    it("媒体与手动参考图地址相同时保留节点和参考对象", async () => {
        mocks.media.mockResolvedValue("blob:video");
        mocks.image.mockResolvedValue("blob:ref");
        const nodes: CanvasNodeData[] = [{id:"video", title:"视频",type:CanvasNodeType.Video,position:{x:0,y:0},width:280,height:200,metadata:{storageKey:"file:video",content:"blob:video",referenceImages:[{id:"ref",name:"参考",type:"image/png",storageKey:"image:ref",dataUrl:"blob:ref"}]}}];
        expect(await hydrateCanvasImages(nodes)).toBe(nodes);
    });
});

describe("异步读盘与生成状态并发", () => {
    const original: CanvasNodeData = { id: "video", title: "视频", type: CanvasNodeType.Video, position: { x: 0, y: 0 }, width: 280, height: 200, metadata: { status: "loading", storageKey: "file:old", content: "blob:old", videoTaskId: "async_old" } };
    const hydrated = { ...original, metadata: { ...original.metadata, content: "blob:restored-old" } };

    it.each(["error", "success"] as const)("较早读盘不得覆盖后到的 %s 终态、媒体和任务凭据", status => {
        const latest = [{ ...original, metadata: { status, content: "blob:new", storageKey: "file:new", videoTaskId: undefined } }];
        const result = reconcileHydratedCanvasNodes([original], [hydrated], latest);
        expect(result).toBe(latest);
        expect(result[0].metadata).toEqual(latest[0].metadata);
    });

    it("只移动节点时保留新位置，同时补齐当前素材的预览地址", () => {
        const moved = { ...original, position: { x: 200, y: 300 }, width: 420 };
        const result = reconcileHydratedCanvasNodes([original], [hydrated], [moved]);
        expect(result[0]).toMatchObject({ position: moved.position, width: 420, metadata: { content: "blob:restored-old" } });
        expect(result[0].metadata).toBe(hydrated.metadata);
    });

    it("不会复活已删除节点，也不会丢掉读盘期间新加入的节点", () => {
        const added = { ...original, id: "new-video" };
        const latest = [added];
        expect(reconcileHydratedCanvasNodes([original], [hydrated], latest)).toBe(latest);
        expect(reconcileHydratedCanvasNodes([original], [hydrated], [])).toEqual([]);
    });

    it("没有并发修改时复用完整的恢复数组", () => {
        const snapshot = [original];
        const restored = [hydrated];
        expect(reconcileHydratedCanvasNodes(snapshot, restored, snapshot)).toBe(restored);
    });
});
