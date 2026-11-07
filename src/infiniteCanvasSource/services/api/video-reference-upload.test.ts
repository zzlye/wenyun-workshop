import axios from "axios";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchVideoCapabilities } from "../../../lib/videoCapabilities";
import { getImageBlob } from "../image-storage";
import { defaultConfig } from "../../stores/use-config-store";
import { requestVideoGeneration } from "./video";
vi.mock("axios", () => ({ default: { post: vi.fn(), get: vi.fn(), isAxiosError: (e: any) => Boolean(e?.isAxiosError) } }));
vi.mock("../../../lib/videoCapabilities", async original => ({ ...await original<any>(), fetchVideoCapabilities: vi.fn() }));
vi.mock("../image-storage", () => ({ getImageBlob: vi.fn() }));
const config = { ...defaultConfig, videoApiKey: "video-key", videoModel: "seedance-2.5-720p-按次", videoSeconds: "5" };
beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchVideoCapabilities).mockResolvedValue({ model: config.videoModel, configured: false, version: 0, variants: [] });
    vi.mocked(axios.post).mockImplementation(async (url, body) => url === "/image-tasks/media-reference-uploads"
        ? { data: { url: `https://cdn.test/${(body as Blob).type.replace("/", ".")}` } }
        : { data: { id: "saved", status: "completed" } });
    vi.mocked(axios.get).mockResolvedValue({ data: new Blob(["video"], { type: "video/mp4" }) });
});
afterEach(() => vi.unstubAllGlobals());
it.each([true, false])("能力配置 %s：图片音频视频都先上传，重复素材只传一次且生成只含URL", async configured => {
    vi.mocked(fetchVideoCapabilities).mockResolvedValue({ model: config.videoModel, configured, version: 1, variants: [{ duration: { min: 1, max: 30 } }] });
    const img = { id: "image", name: "图", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" };
    await requestVideoGeneration(config, "镜头", [img, img], [{ id: "audio", name: "音乐", type: "audio/wav", url: "data:audio/wav;base64,YXVkaW8=" }], [{ id: "video", name: "视频", type: "video/mp4", url: "data:video/mp4;base64,dmlkZW8=" }]);
    const calls = vi.mocked(axios.post).mock.calls;
    expect(calls).toHaveLength(4);
    for (const call of calls.slice(0, 3)) {
        expect(call[0]).toBe("/image-tasks/media-reference-uploads"); expect(call[1]).toBeInstanceOf(Blob);
        expect(call[2]?.headers).toMatchObject({ Authorization: "Bearer video-key" });
    }
    expect(calls[3][1]).toMatchObject({ image_urls: ["https://cdn.test/image.png", "https://cdn.test/image.png"], audio_urls: ["https://cdn.test/audio.wav"], video_urls: ["https://cdn.test/video.mp4"] });
    expect(JSON.stringify(calls[3][1])).not.toMatch(/data:|base64|blob:|asset_id/);
});
it("首尾帧从本地存储读取原图，已存在的公网URL保持原样和顺序", async () => {
    vi.mocked(getImageBlob).mockResolvedValue(new Blob(["original"], { type: "image/png" }));
    await requestVideoGeneration({ ...config, videoMode: "frames" }, "镜头", [
        { id: "first", name: "首帧", type: "image/png", dataUrl: "", storageKey: "stored", url: "blob:expired" },
        { id: "last", name: "尾帧", type: "image/png", dataUrl: "", url: "https://cdn.test/last.png?sig=abc%2B123" },
    ]);
    const calls = vi.mocked(axios.post).mock.calls;
    expect(calls).toHaveLength(2); expect(await (calls[0][1] as Blob).text()).toBe("original");
    expect(calls[1][1]).toMatchObject({ first_frame: "https://cdn.test/image.png", last_frame: "https://cdn.test/last.png?sig=abc%2B123" });
});
it.each([null, { asset_id: "old" }, { url: "data:image/png;base64,eA==" }, { url: "http://127.0.0.1/ref.png" }])("上传返回异常 %j 时不创建付费任务", async result => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: result });
    await expect(requestVideoGeneration(config, "镜头", [{ id: "i", name: "图片", type: "image/png", dataUrl: "data:image/png;base64,aQ==" }])).rejects.toThrow("公网地址");
    expect(axios.post).toHaveBeenCalledTimes(1);
});
it("上传429显示原错误，不回退Base64也不自动创建新任务", async () => {
    vi.mocked(axios.post).mockRejectedValueOnce({ isAxiosError: true, response: { status: 429, data: { error: { message: "素材上传过于频繁" } } } });
    await expect(requestVideoGeneration(config, "镜头", [{ id: "i", name: "图片", type: "image/png", dataUrl: "data:image/png;base64,aQ==" }])).rejects.toThrow("素材上传过于频繁");
    expect(axios.post).toHaveBeenCalledTimes(1);
});
