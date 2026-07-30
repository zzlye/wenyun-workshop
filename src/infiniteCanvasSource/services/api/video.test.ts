import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { CANVAS_VIDEO_MODEL } from "../../../lib/videoModel";
import { defaultConfig } from "../../stores/use-config-store";
import { requestVideoGeneration } from "./video";

vi.mock("axios", () => ({
    default: {
        post: vi.fn(),
        get: vi.fn(),
        isAxiosError: vi.fn((error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError)),
    },
}));

const videoBlob = () => new Blob(["video"], { type: "video/mp4" });

describe("画布 Seedance 2.0 视频接口", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("固定使用标准 videos 异步接口和指定模型", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-1", status: "processing" } });
        (axios.get as Mock)
            .mockResolvedValueOnce({ data: { task_id: "task-1", status: "completed", video_url: "https://cdn.example.com/result.mp4" } })
            .mockResolvedValueOnce({ data: videoBlob() });

        const result = await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "旧模型会被忽略",
            videoSeconds: "4",
            vquality: "1080",
            size: "1280x720",
        }, "雨夜霓虹街道，镜头缓慢推进");

        expect(axios.post).toHaveBeenCalledWith(
            "https://api.example.com/v1/videos",
            {
                model: CANVAS_VIDEO_MODEL,
                prompt: "雨夜霓虹街道，镜头缓慢推进",
                aspect_ratio: "16:9",
                resolution: "720p",
                seconds: "10",
            },
            expect.objectContaining({
                headers: { Authorization: "Bearer video-key", "Content-Type": "application/json" },
            }),
        );
        expect(axios.get).toHaveBeenNthCalledWith(1, "https://api.example.com/v1/videos/task-1", expect.objectContaining({ headers: { Authorization: "Bearer video-key" } }));
        expect(axios.get).toHaveBeenNthCalledWith(2, "https://api.example.com/v1/videos/task-1/content", expect.objectContaining({ responseType: "blob" }));
        expect(result.type).toBe("video/mp4");
    });

    it("按文档提交多图和音频参考字段", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { code: 0, data: { id: "task-2", status: "completed" } } });
        (axios.get as Mock).mockResolvedValueOnce({ data: videoBlob() });

        await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com",
            videoApiKey: "video-key",
            videoSeconds: "15",
            size: "1024x768",
        }, "保持人物外貌一致并参考音乐节奏", [
            { id: "image-1", name: "主图", type: "image/png", dataUrl: "data:image/png;base64,bWFpbg==" },
            { id: "image-2", name: "参考图", type: "image/png", dataUrl: "data:image/png;base64,cmVm" },
        ], [
            { id: "audio-1", name: "音乐", type: "audio/mpeg", url: "https://cdn.example.com/music.mp3", duration: 10 },
        ]);

        expect(axios.post).toHaveBeenCalledWith(
            "https://api.example.com/v1/videos",
            expect.objectContaining({
                model: CANVAS_VIDEO_MODEL,
                aspect_ratio: "4:3",
                resolution: "720p",
                seconds: "15",
                image_url: "data:image/png;base64,bWFpbg==",
                reference_image_urls: ["data:image/png;base64,cmVm"],
                audio_url: "https://cdn.example.com/music.mp3",
            }),
            expect.any(Object),
        );
    });

    it("上游任务失败时显示真实错误", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-3", status: "queued" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-3", status: "failed", error: { message: "上游审核未通过" } } });

        await expect(requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
        }, "测试视频")).rejects.toThrow("上游审核未通过");
    });

    it("content 地址不可用时回退下载任务返回的视频地址", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-4", status: "completed", video_url: "https://cdn.example.com/result.mp4" } });
        (axios.get as Mock).mockRejectedValueOnce({ isAxiosError: true, response: { status: 404 } });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(videoBlob()));

        const result = await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
        }, "测试视频");

        expect(fetch).toHaveBeenCalledWith("https://cdn.example.com/result.mp4", { cache: "no-store", headers: undefined });
        expect(result.type).toBe("video/mp4");
    });

    it("拒绝只连接音频或超过文档限制的参考文件", async () => {
        const config = { ...defaultConfig, videoBaseUrl: "https://api.example.com/v1", videoApiKey: "video-key" };
        await expect(requestVideoGeneration(config, "测试视频", [], [
            { id: "audio-1", name: "音乐", type: "audio/mpeg", url: "https://cdn.example.com/music.mp3" },
        ])).rejects.toThrow("必须同时连接至少一张参考图");

        const images = Array.from({ length: 10 }, (_, index) => ({
            id: `image-${index}`,
            name: `图片${index}`,
            type: "image/png",
            dataUrl: "data:image/png;base64,dGVzdA==",
        }));
        await expect(requestVideoGeneration(config, "测试视频", images)).rejects.toThrow("最多连接 9 张");
        expect(axios.post).not.toHaveBeenCalled();
    });

    it("缺少视频地址或 Key 时直接提示配置", async () => {
        await expect(requestVideoGeneration(defaultConfig, "测试视频")).rejects.toThrow("请先在设置里填写视频 API URL 和 Key");
        expect(axios.post).not.toHaveBeenCalled();
    });
});
