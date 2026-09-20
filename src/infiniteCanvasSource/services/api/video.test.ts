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
            videoModel: "api-video-model-v3",
            videoSeconds: "4",
            vquality: "1080",
            size: "1280x720",
        }, "雨夜霓虹街道，镜头缓慢推进");

        expect(axios.post).toHaveBeenCalledWith(
            `${VIDEO_API_PROXY_BASE}/videos`,
            {
                model: "api-video-model-v3",
                prompt: "雨夜霓虹街道，镜头缓慢推进",
                aspect_ratio: "16:9",
                duration: 4,
                resolution: "1080p",
                generate_audio: true,
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

    it("Kling 使用统一图像音频数组，保留用户时长、比例和清晰度", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "kling-task-2", status: "completed" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: videoBlob() });

        await requestVideoGeneration({
            ...defaultConfig,
            videoApiKey: "video-key",
            videoModel: "kling-3.0-omni-1080p",
            videoSeconds: "8",
            vquality: "480",
            size: "4:3",
        }, "人物在雨中回头", [
            { id: "character", name: "角色", type: "image/png", dataUrl: "data:image/png;base64,Y2hhcmFjdGVy" },
        ], [
            { id: "audio", name: "参考音频", type: "audio/mpeg", url: "https://cdn.example.com/music.mp3" },
        ]);

        expect(axios.post).toHaveBeenCalledWith(
            `${VIDEO_API_PROXY_BASE}/videos`,
            {
                model: "kling-3.0-omni-1080p",
                prompt: "人物在雨中回头",
                aspect_ratio: "4:3",
                duration: 8,
                resolution: "480p",
                generate_audio: true,
                image_urls: ["data:image/png;base64,Y2hhcmFjdGVy"],
                audio_urls: ["https://cdn.example.com/music.mp3"],
            },
            expect.any(Object),
        );
        expect((axios.post as Mock).mock.calls[0][1]).not.toHaveProperty("audio_url");
        expect((axios.post as Mock).mock.calls[0][1]).not.toHaveProperty("audio_reference");
    });

    it("Kling 多图使用 image_urls，保持参考顺序", async () => {
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

    it("中转要求对象格式时，将首张 data URL 改为 input_reference.image_url 重试", async () => {
        (axios.post as Mock)
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 422, data: { error: { message: "input_reference must be an object containing image_url" } } } })
            .mockResolvedValueOnce({ data: { id: "task-object-reference", status: "completed" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: videoBlob() });

        await requestVideoGeneration({ ...defaultConfig, videoApiKey: "video-key" }, "参考图片生成视频", [
            { id: "image-1", name: "参考图", type: "image/png", dataUrl: "data:image/png;base64,cmVm" },
        ]);

        expect((axios.post as Mock).mock.calls).toHaveLength(2);
        expect((axios.post as Mock).mock.calls[0][1].image_urls).toEqual(["data:image/png;base64,cmVm"]);
        expect((axios.post as Mock).mock.calls[1][1]).toMatchObject({ input_reference: { image_url: "data:image/png;base64,cmVm" } });
        expect((axios.post as Mock).mock.calls[1][1]).not.toHaveProperty("image_urls");
    });

    it("对象格式被 Go 接口拒绝为字符串时继续兼容 input_reference 字符串", async () => {
        (axios.post as Mock)
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 422, data: { error: { message: "input_reference must be an object containing image_url" } } } })
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 422, data: { error: { message: "json: cannot unmarshal object into Go struct field Alias.input_reference of type string" } } } })
            .mockResolvedValueOnce({ data: { id: "task-string-reference", status: "completed" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: videoBlob() });

        await requestVideoGeneration({ ...defaultConfig, videoApiKey: "video-key" }, "兼容字符串参考图", [
            { id: "image-1", name: "参考图", type: "image/png", dataUrl: "data:image/png;base64,cmVm" },
        ]);

        expect((axios.post as Mock).mock.calls[2][1]).toMatchObject({ input_reference: "data:image/png;base64,cmVm" });
        expect((axios.post as Mock).mock.calls[2][1]).not.toHaveProperty("image_urls");
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
                audio_urls: ["https://cdn.example.com/music.mp3"],
            }),
            expect.any(Object),
        );
    });

    it("Seedance 2.5 保留对应时长并使用统一音频数组字段", async () => {
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
                aspect_ratio: "4:3",
                audio_urls: ["https://cdn.example.com/beat.mp3"],
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
        (axios.get as Mock)
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 502 } })
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 502 } });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(videoBlob()));

        const result = await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
        }, "测试视频");

        expect(fetch).toHaveBeenCalledWith("/asset-proxy/https/cdn.example.com/result.mp4", expect.objectContaining({ cache: "no-store", headers: undefined, signal: expect.any(AbortSignal) }));
        expect(result.type).toBe("video/mp4");
    });

    it("主 content 代理失败时回退同源 NewAPI 路径", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-content-fallback", status: "completed" } });
        (axios.get as Mock)
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 502 } })
            .mockResolvedValueOnce({ data: videoBlob() });

        const result = await requestVideoGeneration({
            ...defaultConfig,
            videoApiKey: "video-key",
        }, "测试同源回退");

        expect(axios.get).toHaveBeenNthCalledWith(2, "/newapi-proxy/wenyun/v1/videos/task-content-fallback/content", expect.objectContaining({ responseType: "blob" }));
        expect(result.type).toBe("video/mp4");
    });

    it("连接公网视频时提交 video_urls 数组", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-reference-video", status: "completed" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: videoBlob() });

        await requestVideoGeneration({
            ...defaultConfig,
            videoApiKey: "video-key",
            videoModel: "kling-3.0-omni-720p",
        }, "参考视频的镜头节奏", [], [], [
            { id: "reference-video", name: "参考视频", type: "video/mp4", url: "https://cdn.example.com/reference.mp4" },
        ]);

        expect(axios.post).toHaveBeenCalledWith(
            `${VIDEO_API_PROXY_BASE}/videos`,
            expect.objectContaining({ video_urls: ["https://cdn.example.com/reference.mp4"] }),
            expect.any(Object),
        );
    });

    it("不再强制音频配图或限制 Seedance 图片数量", async () => {
        const config = { ...defaultConfig, videoBaseUrl: "https://api.example.com/v1", videoApiKey: "video-key" };
        (axios.post as Mock).mockResolvedValue({ data: { id: "task-references", status: "completed" } });
        (axios.get as Mock).mockResolvedValue({ data: videoBlob() });
        await requestVideoGeneration(config, "测试视频", [], [
            { id: "audio-1", name: "音乐", type: "audio/mpeg", url: "https://cdn.example.com/music.mp3" },
        ]);
        expect((axios.post as Mock).mock.calls[0][1].audio_urls).toEqual(["https://cdn.example.com/music.mp3"]);

        const images = Array.from({ length: 10 }, (_, index) => ({
            id: `image-${index}`,
            name: `图片${index}`,
            type: "image/png",
            dataUrl: "data:image/png;base64,dGVzdA==",
        }));
        await requestVideoGeneration(config, "测试视频", images);
        expect((axios.post as Mock).mock.calls[1][1].image_urls).toEqual(images.map((image) => image.dataUrl));
    });

    it("Kling 不再套用旧的两张参考图限制", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-images", status: "completed" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: videoBlob() });
        const images = Array.from({ length: 3 }, (_, index) => ({
            id: `kling-image-${index}`,
            name: `图片${index}`,
            type: "image/png",
            dataUrl: "data:image/png;base64,dGVzdA==",
        }));

        await requestVideoGeneration({
            ...defaultConfig,
            videoApiKey: "video-key",
            videoModel: "kling-3.0-omni-720p",
        }, "测试视频", images);
        expect((axios.post as Mock).mock.calls[0][1].image_urls).toEqual(images.map((image) => image.dataUrl));
    });

    it("缺少 Key 时直接提示配置", async () => {
        await expect(requestVideoGeneration(defaultConfig, "测试视频")).rejects.toThrow("请先在设置里填写视频 API Key");
        expect(axios.post).not.toHaveBeenCalled();
    });
});
