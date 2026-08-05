import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
    setItem: vi.fn(),
    getItem: vi.fn(),
    removeItem: vi.fn(),
    iterate: vi.fn(),
}));

vi.mock("localforage", () => ({
    default: {
        createInstance: () => storageMocks,
    },
}));

vi.mock("nanoid", () => ({ nanoid: () => "test-image" }));

vi.mock("@/lib/image-utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/image-utils")>();
    return {
        ...actual,
        readImageMeta: vi.fn().mockResolvedValue({ width: 3840, height: 2160, mimeType: "image/png" }),
    };
});

import { collectImageStorageKeys, imageToDataUrl, uploadImage } from "./image-storage";

describe("canvas image storage", () => {
    beforeEach(() => {
        storageMocks.setItem.mockResolvedValue(undefined);
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-image");
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("直接解码大型 Base64 图片，不经过 fetch 读取 Data URL", async () => {
        const byteLength = 18 * 1024 * 1024;
        const base64 = "BwcH".repeat(byteLength / 3);

        const uploaded = await uploadImage(`data:image/png;base64,${base64}`);

        expect(fetch).not.toHaveBeenCalled();
        expect(storageMocks.setItem).toHaveBeenCalledWith("image:test-image", expect.any(Blob));
        const storedBlob = storageMocks.setItem.mock.calls[0][1] as Blob;
        expect(storedBlob.size).toBe(byteLength);
        expect(storedBlob.type).toBe("image/png");
        expect(uploaded).toMatchObject({
            storageKey: "image:test-image",
            width: 3840,
            height: 2160,
            bytes: byteLength,
            mimeType: "image/png",
        });
    });

    it("普通图片 URL 继续通过 fetch 下载", async () => {
        const sourceBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValue(new Response(sourceBlob));

        const uploaded = await uploadImage("https://images.example.com/result.webp");

        expect(fetchMock).toHaveBeenCalledWith("https://images.example.com/result.webp");
        expect(uploaded.bytes).toBe(3);
        expect(uploaded.mimeType).toBe("image/webp");
    });

    it("图片清理会保留参考图遮罩的独立存储键", () => {
        const keys = collectImageStorageKeys({
            storageKey: "image:source",
            maskStorageKey: "image:mask",
        });

        expect([...keys]).toEqual(["image:source", "image:mask"]);
    });

    it("请求前可以通过遮罩存储键恢复 Data URL", async () => {
        storageMocks.getItem.mockResolvedValue(new Blob([new Uint8Array([109, 97, 115, 107])], { type: "image/png" }));
        vi.stubGlobal(
            "FileReader",
            class {
                result: string | null = null;
                onload: (() => void) | null = null;
                onerror: (() => void) | null = null;

                readAsDataURL() {
                    this.result = "data:image/png;base64,bWFzaw==";
                    this.onload?.();
                }
            },
        );

        const dataUrl = await imageToDataUrl({ dataUrl: "blob:mask-preview", storageKey: "image:mask" });

        expect(storageMocks.getItem).toHaveBeenCalledWith("image:mask");
        expect(dataUrl).toBe("data:image/png;base64,bWFzaw==");
    });
});
