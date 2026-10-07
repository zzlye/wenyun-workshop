// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ setItem: vi.fn().mockResolvedValue(undefined) }));
vi.mock("localforage", () => ({ default: { createInstance: () => storage } }));
vi.mock("nanoid", () => ({ nanoid: () => "saved" }));

import { uploadMediaFile } from "./file-storage";

describe("视频本地保存", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        storage.setItem.mockClear();
    });

    it("元数据迟迟不返回时仍完成已入库视频的节点保存", async () => {
        vi.useFakeTimers();
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:saved");
        const result = uploadMediaFile(new Blob(["video"], { type: "video/mp4" }), "video");
        await Promise.resolve();
        expect(storage.setItem).toHaveBeenCalledWith("video:saved", expect.any(Blob));
        await vi.advanceTimersByTimeAsync(3000);

        await expect(result).resolves.toMatchObject({ storageKey: "video:saved", width: 1280, height: 720 });
    });
});
