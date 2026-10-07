import axios from "axios";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchVideoCapabilities } from "../../../lib/videoCapabilities";
import { defaultConfig } from "../../stores/use-config-store";
import { requestVideoGeneration, VideoTaskPendingError } from "./video";
vi.mock("axios", () => ({
    default: { post: vi.fn(), get: vi.fn(), isAxiosError: (e: { isAxiosError?: boolean }) => Boolean(e?.isAxiosError) },
}));
vi.mock("../../../lib/videoCapabilities", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/videoCapabilities")>()),
    fetchVideoCapabilities: vi.fn(),
}));
const config = { ...defaultConfig, videoApiKey: "test", videoModel: "any-new-model", videoSeconds: "5", size: "16:9" };
beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchVideoCapabilities).mockResolvedValue({
        model: config.videoModel,
        version: 1,
        configured: true,
        variants: [
            {
                duration: { min: 1, max: 30 },
                generate_audio: true,
                first_frame_with_video: true,
                prompt_optional_with_image: true,
                parameters: [{ key: "seed", label: "种子", type: "integer", editable: true }],
            },
        ],
    });
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "saved", status: "completed" } });
    vi.mocked(axios.get).mockResolvedValue({ data: new Blob(["video"], { type: "video/mp4" }) });
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
it("任意模型自定义零值和音频false按统一协议提交", async () => {
    await requestVideoGeneration({ ...config, videoExtraParameters: { seed: 0 }, videoGenerateAudio: false }, "镜头");
    expect(vi.mocked(axios.post).mock.calls[0][1]).toMatchObject({
        model: "any-new-model",
        extra_parameters: { seed: 0 },
        generate_audio: false,
        mode: "text",
    });
});
it("首尾帧保持输入顺序，第三张图片明确拒绝且无生成请求", async () => {
    const images = [1, 2, 3].map((n) => ({
        id: String(n),
        name: "图片",
        type: "image/png",
        dataUrl: "",
        url: `https://cdn.test/${n}.png`,
    }));
    await requestVideoGeneration({ ...config, videoMode: "frames" }, "", images.slice(0, 2));
    expect(vi.mocked(axios.post).mock.calls[0][1]).toMatchObject({ first_frame: images[0].url, last_frame: images[1].url, mode: "frames" });
    expect(vi.mocked(axios.post).mock.calls[0][1]).not.toHaveProperty("image_urls");
    vi.mocked(axios.post).mockClear();
    await expect(requestVideoGeneration({ ...config, videoMode: "frames" }, "", images)).rejects.toThrow("一张或两张");
    expect(axios.post).not.toHaveBeenCalled();
});
it("本地图片经上传返回素材编号，再单次创建视频任务", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Blob(["png"], { type: "image/png" }))));
    vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { asset_id: "va_saved" } })
        .mockResolvedValueOnce({ data: { id: "saved", status: "completed" } });
    await requestVideoGeneration(config, "图生视频", [
        { id: "i", name: "image.png", type: "image/png", dataUrl: "data:image/png;base64,aQ==" },
    ]);
    expect(vi.mocked(axios.post).mock.calls[0][0]).toContain("/video/assets");
    expect(vi.mocked(axios.post).mock.calls[0][1]).toBeInstanceOf(FormData);
    expect(vi.mocked(axios.post).mock.calls[0][2]?.timeout).toBe(1800000);
    expect(vi.mocked(axios.post).mock.calls[1][1]).toMatchObject({ image_urls: [{ asset_id: "va_saved" }] });
});
it("能力网络错误保留输入并阻止创建，不当作旧模型回退", async () => {
    vi.mocked(fetchVideoCapabilities).mockRejectedValue(new Error("网络中断"));
    await expect(requestVideoGeneration(config, "镜头")).rejects.toThrow("网络中断");
    expect(axios.post).not.toHaveBeenCalled();
});
it("15分钟后继续查询，30分钟后保留等待状态且恢复原任务不重复创建", async () => {
    vi.useFakeTimers();
    vi.mocked(axios.post).mockResolvedValue({ data: { id: "saved", status: "queued" } });
    // 用虚拟时钟跨过等待窗口，不实际等待或发送付费请求。
    vi.mocked(axios.get).mockImplementation(async () => {
        vi.setSystemTime(Date.now() + 900001);
        return { data: { id: "saved", status: "in_progress" } };
    });
    const result = requestVideoGeneration(config, "镜头").catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    const pending = await result;
    expect(pending).toBeInstanceOf(VideoTaskPendingError);
    expect(pending.taskId).toBe("saved");
    expect(axios.post).toHaveBeenCalledTimes(1);
    // 第一次跨过十五分钟仍会查询；第二次跨过三十分钟才结束前台等待。
    expect(axios.get).toHaveBeenCalledTimes(2);
    const firstTimeout = vi.mocked(axios.get).mock.calls[0][1]?.timeout ?? 0;
    expect(firstTimeout).toBeGreaterThan(1799000);
    expect(firstTimeout).toBeLessThanOrEqual(1800000);
    vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: { id: "saved", status: "completed" } })
        .mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
    const resumed = requestVideoGeneration(config, "", [], [], [], { taskId: pending.taskId });
    await vi.advanceTimersByTimeAsync(10);
    expect((await resumed).type).toBe("video/mp4");
    expect(axios.post).toHaveBeenCalledTimes(1);
    const downloadTimeout = vi.mocked(axios.get).mock.calls.at(-1)?.[1]?.timeout ?? 0;
    expect(downloadTimeout).toBeGreaterThan(1799000);
    expect(downloadTimeout).toBeLessThanOrEqual(1800000);
});
