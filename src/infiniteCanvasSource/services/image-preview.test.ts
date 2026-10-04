import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
vi.mock("./image-storage", () => ({ getImageBlob: mocks.read }));
vi.mock("localforage", () => ({ default: { createInstance: () => ({ getItem: mocks.get, setItem: mocks.set, removeItem: mocks.remove }) } }));

describe("画布原图显示与缓存", () => {
    beforeEach(() => {
        vi.resetModules(); vi.resetAllMocks();
        mocks.get.mockResolvedValue(null); mocks.set.mockResolvedValue(null); mocks.remove.mockResolvedValue(null);
        // 旧实现仍可完成编码，让回归断言直接检查图片字节而非环境缺失。
        vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 2752, height: 1536, close: vi.fn() }));
        vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (done: (blob: Blob) => void) => done(new Blob(["低清预览"], { type: "image/webp" })) }) });
    });
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

    it.each([false, true])("普通或全览显示均使用原始字节和格式，不缩小或重新编码：%s", async (compact) => {
        const original = new Blob([new Uint8Array([137, 80, 78, 71, 0, 1, 255])], { type: "image/png" });
        mocks.read.mockResolvedValue(original);
        const { requestImagePreview } = await import("./image-preview");
        const request = requestImagePreview("image:original", "", compact);
        try {
            const shown = await (await fetch(await request.promise)).blob();
            expect(shown.type).toBe(original.type);
            expect(await shown.arrayBuffer()).toEqual(await original.arrayBuffer());
            expect(createImageBitmap).not.toHaveBeenCalled();
            expect(mocks.set).not.toHaveBeenCalled();
        } finally { request.release(); }
    });

    it("已有旧512像素缓存时仍读取原图，用户无需清空画布", async () => {
        const original = new Blob(["原始图片"], { type: "image/png" });
        mocks.get.mockResolvedValue(new Blob(["旧低清缓存"], { type: "image/webp" }));
        mocks.read.mockResolvedValue(original);
        const { requestImagePreview } = await import("./image-preview");
        const request = requestImagePreview("image:cached");
        try {
            expect(await (await fetch(await request.promise)).text()).toBe("原始图片");
            expect(mocks.read).toHaveBeenCalledWith("image:cached");
            expect(mocks.get).not.toHaveBeenCalled();
        } finally { request.release(); }
    });

    it("缩放和选中切换复用同一份原图，不重新读取或生成不同尺寸", async () => {
        mocks.read.mockResolvedValue(new Blob(["原图"]));
        const { requestImagePreview } = await import("./image-preview");
        const small = requestImagePreview("image:shared", "", true);
        const full = requestImagePreview("image:shared");
        try {
            expect(await small.promise).toBe(await full.promise);
            expect(mocks.read).toHaveBeenCalledTimes(1);
        } finally { small.release(); full.release(); }
    });

    it("本地缺失或仅有远程地址时保留原始响应图片字节", async () => {
        mocks.read.mockResolvedValue(null);
        const original = new Blob(["原始网络图片"], { type: "image/jpeg" });
        const createUrl = vi.spyOn(URL, "createObjectURL");
        const fetchImage = vi.fn().mockResolvedValue({ ok: true, blob: async () => original });
        vi.stubGlobal("fetch", fetchImage);
        const { requestImagePreview } = await import("./image-preview");
        const request = requestImagePreview("image:missing", "https://example.test/original.jpg");
        try {
            await request.promise;
            expect(fetchImage).toHaveBeenCalledWith("https://example.test/original.jpg", expect.objectContaining({ signal: expect.any(AbortSignal) }));
            expect(createUrl).toHaveBeenCalledWith(original);
        } finally { request.release(); }
    });

    it("覆盖原图后重新读取，使用中的旧地址保留到组件释放", async () => {
        mocks.read.mockResolvedValueOnce(new Blob(["旧原图"])).mockResolvedValueOnce(new Blob(["新原图"]));
        const revoke = vi.spyOn(URL, "revokeObjectURL");
        const { requestImagePreview, deleteImagePreviews } = await import("./image-preview");
        const old = requestImagePreview("image:replace");
        const oldUrl = await old.promise;
        await deleteImagePreviews(["image:replace"]);
        expect(revoke).not.toHaveBeenCalledWith(oldUrl);
        const next = requestImagePreview("image:replace");
        try {
            expect(await (await fetch(await next.promise)).text()).toBe("新原图");
            expect(mocks.remove).toHaveBeenCalledWith("image:replace:128");
            expect(mocks.remove).toHaveBeenCalledWith("image:replace:512");
        } finally { old.release(); next.release(); }
        expect(revoke).toHaveBeenCalledWith(oldUrl);
    });
});
