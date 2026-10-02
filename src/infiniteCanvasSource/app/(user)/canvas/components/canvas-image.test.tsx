// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({request:vi.fn(),original:vi.fn()}));
vi.mock("@/services/image-preview", () => ({requestImagePreview:mocks.request}));
vi.mock("@/services/image-storage", () => ({resolveImageUrl:mocks.original}));
import { CanvasImage } from "./canvas-image";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT:true });
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); vi.clearAllMocks(); });

describe("画布异步缩略图", () => {
    it("切换图片后旧请求不覆盖新图，卸载释放预览租约", async () => {
        let resolveOld!: (url:string)=>void;
        const oldRelease = vi.fn(); const newRelease = vi.fn();
        mocks.request.mockReturnValueOnce({promise:new Promise<string>(resolve => {resolveOld=resolve;}),release:oldRelease})
            .mockReturnValueOnce({promise:Promise.resolve("blob:new"),release:newRelease});
        host=document.createElement("div"); root=createRoot(host);
        await act(async () => root.render(<CanvasImage storageKey="image:old" alt="图片" />));
        expect(host.querySelector('img')?.getAttribute('src')).toBeNull();
        await act(async () => root.render(<CanvasImage storageKey="image:new" alt="图片" />));
        expect(oldRelease).toHaveBeenCalledTimes(1);
        await act(async () => resolveOld("blob:old"));
        expect(host.querySelector('img')?.getAttribute('src')).toBe("blob:new");
        await act(async () => root.render(null));
        expect(newRelease).toHaveBeenCalledTimes(1);
        expect(mocks.original).not.toHaveBeenCalled();
    });
    it("缩略图失败仍可展示原图，不修改传入的存储键", async () => {
        mocks.request.mockReturnValue({promise:Promise.reject(new Error("格式不支持")),release:vi.fn()});
        mocks.original.mockResolvedValue("blob:original");
        host=document.createElement("div"); root=createRoot(host);
        await act(async () => root.render(<CanvasImage storageKey="image:original" src="https://example.test/original.png" />));
        expect(mocks.original).toHaveBeenCalledWith("image:original","https://example.test/original.png");
        expect(host.querySelector('img')?.getAttribute('src')).toBe("blob:original");
    });
});
