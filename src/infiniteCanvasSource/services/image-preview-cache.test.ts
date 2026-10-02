import { describe, expect, it, vi } from "vitest";
import { createImagePreviewCache } from "./image-preview-cache";

describe("缩略图并发及生命周期", () => {
    it("同图请求复用任务，限制并发，跳过已离开视口的等待任务", async () => {
        const pending = new Map<string, (blob: Blob) => void>();
        const load = vi.fn((key: string) => new Promise<Blob>((resolve) => pending.set(key, resolve)));
        const cache = createImagePreviewCache(load, {concurrency:1,idleLimit:0});
        const first = cache.request("1");
        const same = cache.request("1");
        const gone = cache.request("2");
        gone.release();
        expect(load).toHaveBeenCalledTimes(1);
        pending.get("1")!(new Blob(["缩略图"]));
        expect(await first.promise).toBe(await same.promise);
        expect(await gone.promise).toBe("");
        expect(load).not.toHaveBeenCalledWith("2");
        first.release(); same.release();
    });
    it("仍显示的地址不回收，释放幂等且只回收超过上限的空闲缓存", async () => {
        const revoke = vi.spyOn(URL, "revokeObjectURL");
        const cache = createImagePreviewCache(async () => new Blob(["缩略图"]), {idleLimit:0});
        const first = cache.request("1");
        const second = cache.request("1");
        const url = await first.promise;
        first.release(); first.release();
        expect(revoke).not.toHaveBeenCalledWith(url);
        second.release();
        expect(revoke).toHaveBeenCalledWith(url);
        revoke.mockRestore();
    });
    it("失败后可再次请求，不留下永久失败缓存", async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error("临时失败")).mockResolvedValue(new Blob(["缩略图"]));
        const cache = createImagePreviewCache(load, {idleLimit:0});
        const first = cache.request("1");
        await expect(first.promise).rejects.toThrow("临时失败"); first.release();
        const retry = cache.request("1");
        expect(await retry.promise).toMatch(/^blob:/); retry.release();
    });
    it("失效不会回收使用中的旧图，新请求读取新内容", async () => {
        const load = vi.fn(async () => new Blob(["缩略图"]));
        const revoke = vi.spyOn(URL,"revokeObjectURL");
        const cache = createImagePreviewCache(load,{idleLimit:0});
        const first = cache.request("1"); const old = await first.promise;
        cache.invalidate(key=>key==="1");
        expect(revoke).not.toHaveBeenCalledWith(old);
        const second = cache.request("1"); const latest = await second.promise;
        expect(latest).not.toBe(old); expect(load).toHaveBeenCalledTimes(2);
        first.release(); expect(revoke).toHaveBeenCalledWith(old);
        second.release(); revoke.mockRestore();
    });
    it("地址创建异常也结束任务并放行后续请求", async () => {
        const create = vi.spyOn(URL,"createObjectURL").mockImplementationOnce(()=>{throw new Error("缓存格式错误");});
        const cache = createImagePreviewCache(async()=>new Blob(["缩略图"]),{concurrency:1,idleLimit:0});
        const broken=cache.request("broken"); const next=cache.request("next");
        await expect(broken.promise).rejects.toThrow("缓存格式错误");
        expect(await next.promise).toMatch(/^blob:/);
        broken.release(); next.release(); create.mockRestore();
    });
});
