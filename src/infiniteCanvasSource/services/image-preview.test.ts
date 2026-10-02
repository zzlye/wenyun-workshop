import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({read:vi.fn(),get:vi.fn(),set:vi.fn(),remove:vi.fn()}));
vi.mock("./image-storage",()=>({getImageBlob:mocks.read}));
vi.mock("localforage",()=>({default:{createInstance:()=>({getItem:mocks.get,setItem:mocks.set,removeItem:mocks.remove})}}));

describe("图片缩略图生成", () => {
    beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.get.mockResolvedValue(null); mocks.set.mockResolvedValue(null); mocks.remove.mockResolvedValue(null); });
    afterEach(() => vi.unstubAllGlobals());
    it("4K 原图另存透明缩略图，原图 Blob 不被替换，解码资源及时关闭", async () => {
        const original = new Blob(["原图"],{type:"image/png"});
        const thumbnail = new Blob(["缩略图"],{type:"image/webp"});
        mocks.read.mockResolvedValue(original);
        const close=vi.fn(); const draw=vi.fn();
        vi.stubGlobal("createImageBitmap",vi.fn().mockResolvedValue({width:4096,height:2048,close}));
        const canvas={width:0,height:0,getContext:()=>({drawImage:draw}),toBlob:(callback:(blob:Blob)=>void)=>callback(thumbnail)};
        vi.stubGlobal("document",{createElement:()=>canvas});
        const {requestImagePreview}=await import("./image-preview");
        const large=requestImagePreview("image:one"); await large.promise;
        expect(canvas.width).toBe(512); expect(canvas.height).toBe(256);
        expect(mocks.set).toHaveBeenCalledWith("image:one:512",thumbnail);
        expect(mocks.read).toHaveBeenCalledWith("image:one");
        expect(close).toHaveBeenCalledTimes(1);
        const small=requestImagePreview("image:one","",true); await small.promise;
        expect(canvas.width).toBe(128); expect(canvas.height).toBe(64);
        expect(original.size).toBe(new Blob(["原图"]).size);
        large.release(); small.release();
    });
    it("持久化缩略图命中时不读取也不解码原图", async () => {
        mocks.get.mockResolvedValue(new Blob(["缓存"]));
        const {requestImagePreview}=await import("./image-preview");
        const request=requestImagePreview("image:cached"); await request.promise; request.release();
        expect(mocks.read).not.toHaveBeenCalled();
    });
});
