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
const VIDEO_API_PROXY_BASE = "/api-proxy/wenyun";

describe("画布视频异步接口", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("固定使用 NewAPI 同源代理、文档字段和异步轮询", async () => {
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
            `${VIDEO_API_PROXY_BASE}/videos`,
            {
                model: CANVAS_VIDEO_MODEL,
                prompt: "雨夜霓虹街道，镜头缓慢推进",
                aspect_ratio: "16:9",
                duration: 4,
            },
            expect.objectContaining({
                headers: { Authorization: "Bearer video-key", "Content-Type": "application/json" },
                timeout: 900000,
            }),
        );
        expect(axios.get).toHaveBeenNthCalledWith(1, `${VIDEO_API_PROXY_BASE}/videos/task-1`, expect.objectContaining({ headers: { Authorization: "Bearer video-key" } }));
        expect(axios.get).toHaveBeenNthCalledWith(2, `${VIDEO_API_PROXY_BASE}/videos/task-1/content`, expect.objectContaining({ responseType: "blob" }));
        expect(result.type).toBe("video/mp4");
    });

    it("Kling 单图使用 image_url，并限制时长、比例和音频字段", async () => {
        await expect(requestVideoGeneration({
            ...defaultConfig,
            videoApiKey: "video-key",
            videoModel: "kling-3.0-omni-1080p",
            videoSeconds: "8",
            size: "4:3",
        }, "人物在雨中回头", [
            { id: "character", name: "角色", type: "image/png", dataUrl: "data:image/png;base64,Y2hhcmFjdGVy" },
        ], [
            { id: "ignored-audio", name: "不支持的音频", type: "audio/mpeg", url: "https://cdn.example.com/music.mp3" },
        ])).rejects.toThrow("Kling 模型不支持参考音频，请移除音频节点后重试");

        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "kling-task-2", status: "completed" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: videoBlob() });

        await requestVideoGeneration({
            ...defaultConfig,
            videoApiKey: "video-key",
            videoModel: "kling-3.0-omni-1080p",
            videoSeconds: "8",
            size: "4:3",
        }, "人物在雨中回头", [
            { id: "character", name: "角色", type: "image/png", dataUrl: "data:image/png;base64,Y2hhcmFjdGVy" },
        ]);

        expect(axios.post).toHaveBeenCalledWith(
            `${VIDEO_API_PROXY_BASE}/videos`,
            {
                model: "kling-3.0-omni-1080p",
                prompt: "人物在雨中回头",
                aspect_ratio: "16:9",
                duration: 10,
                generate_audio: true,
                image_url: "data:image/png;base64,Y2hhcmFjdGVy",
            },
            expect.any(Object),
        );
        expect((axios.post as Mock).mock.calls[0][1]).not.toHaveProperty("audio_url");
        expect((axios.post as Mock).mock.calls[0][1]).not.toHaveProperty("audio_reference");
    });

    it("Kling 双图使用 image_urls 作为首尾帧", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "kling-task-3", status: "completed" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: videoBlob() });

        await requestVideoGeneration({
            ...defaultConfig,
            videoApiKey: "video-key",
            videoModel: "kling-3.0-omni-720p",
            videoSeconds: "15",
            size: "9:16",
        }, "从站立到奔跑", [
            { id: "first", name: "首帧", type: "image/png", dataUrl: "data:image/png;base64,Zmlyc3Q=" },
            { id: "last", name: "尾帧", type: "image/png", dataUrl: "data:image/png;base64,bGFzdA==" },
        ]);

        expect(axios.post).toHaveBeenCalledWith(
            `${VIDEO_API_PROXY_BASE}/videos`,
            expect.objectContaining({
                model: "kling-3.0-omni-720p",
                aspect_ratio: "9:16",
                duration: 15,
                image_urls: ["data:image/png;base64,Zmlyc3Q=", "data:image/png;base64,bGFzdA=="],
            }),
            expect.any(Object),
        );
        expect((axios.post as Mock).mock.calls[0][1]).not.toHaveProperty("image_url");
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
            `${VIDEO_API_PROXY_BASE}/videos`,
            expect.objectContaining({
                model: CANVAS_VIDEO_MODEL,
                aspect_ratio: "4:3",
                duration: 15,
                image_urls: ["data:image/png;base64,bWFpbg==", "data:image/png;base64,cmVm"],
                audio_url: "https://cdn.example.com/music.mp3",
            }),
            expect.any(Object),
        );
    });

    it("按选中的 Seedance 2.5 模型使用对应时长和参考音频字段", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-25", status: "completed" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: videoBlob() });

        await requestVideoGeneration({
            ...defaultConfig,
            videoApiKey: "video-key",
            videoModel: "seedance-2.5-720p",
            videoSeconds: "29",
            size: "4:3",
        }, "参考主体并按节奏运动", [
            { id: "image-25", name: "主体", type: "image/png", dataUrl: "data:image/png;base64,c3ViamVjdA==" },
        ], [
            { id: "audio-25", name: "节奏", type: "audio/mpeg", url: "https://cdn.example.com/beat.mp3", duration: 10 },
        ]);

        expect(axios.post).toHaveBeenCalledWith(
            `${VIDEO_API_PROXY_BASE}/videos`,
            expect.objectContaining({
                model: "seedance-2.5-720p",
                duration: 29,
                aspect_ratio: "16:9",
                audio_reference: [{ url: "https://cdn.example.com/beat.mp3" }],
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

    it("Kling 最多接受两张参考图", async () => {
        const images = Array.from({ length: 3 }, (_, index) => ({
            id: `kling-image-${index}`,
            name: `图片${index}`,
            type: "image/png",
            dataUrl: "data:image/png;base64,dGVzdA==",
        }));

        await expect(requestVideoGeneration({
            ...defaultConfig,
            videoApiKey: "video-key",
            videoModel: "kling-3.0-omni-720p",
        }, "测试视频", images)).rejects.toThrow("最多连接 2 张");
        expect(axios.post).not.toHaveBeenCalled();
    });

    it("缺少 Key 时直接提示配置", async () => {
        await expect(requestVideoGeneration(defaultConfig, "测试视频")).rejects.toThrow("请先在设置里填写视频 API Key");
        expect(axios.post).not.toHaveBeenCalled();
    });
});
