import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ image: vi.fn(), media: vi.fn(), upload: vi.fn() }));
vi.mock("@/services/image-storage", () => ({ resolveImageUrl: mocks.image, uploadImage: mocks.upload }));
vi.mock("@/services/file-storage", () => ({ resolveMediaUrl: mocks.media }));
import { hydrateCanvasImages, hasCanvasGenerationUpdate } from "./canvas-media-hydration";
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
