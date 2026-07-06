import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { defaultConfig } from "../../stores/use-config-store";
import { requestVideoGeneration } from "./video";

vi.mock("axios", () => ({
    default: {
        post: vi.fn(),
        get: vi.fn(),
        isAxiosError: vi.fn((error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError)),
    },
}));

describe("canvas video api", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("uses multipart videos endpoint first for Grok video 3 pro models", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-grok", status: "processing" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-grok", status: "completed", video_url: "https://cdn.example.com/grok-video.mp4" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        const blob = await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "grok-video-3-pro",
            videoSeconds: "6",
            vquality: "720",
            size: "16:9",
        }, "prompt");

        const [url, body] = (axios.post as Mock).mock.calls[0];
        expect(url).toBe("https://api.example.com/v1/videos");
        expect(body).toBeInstanceOf(FormData);
        expect(body.get("model")).toBe("grok-video-3-pro");
        expect(body.get("prompt")).toBe("prompt");
        expect(body.get("seconds")).toBe("6");
        expect(axios.get).toHaveBeenCalledTimes(2);
        expect(axios.get).toHaveBeenNthCalledWith(2, "https://api.example.com/v1/videos/task-grok/content", expect.objectContaining({ responseType: "blob" }));
        expect(fetch).not.toHaveBeenCalled();
        expect(blob.type).toBe("video/mp4");
    });

    it("uses chat completions first for Grok Imagine video models", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { choices: [{ message: { content: "https://cdn.example.com/grok-imagine.mp4" } }] } });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        const blob = await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://ai.bafang.me/v1",
            videoApiKey: "video-key",
            videoModel: "grok-imagine-video-1.5-720p",
        }, "prompt");

        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(axios.post).toHaveBeenCalledWith(
            "https://ai.bafang.me/v1/chat/completions",
            expect.objectContaining({
                model: "grok-imagine-video-1.5-720p",
                messages: [{ role: "user", content: "prompt" }],
                stream: false,
                temperature: 0.7,
            }),
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer video-key" }) }),
        );
        expect(axios.get).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledWith("https://cdn.example.com/grok-imagine.mp4", expect.any(Object));
        expect(blob.type).toBe("video/mp4");
    });

    it("uses JSON videos endpoint first for Sora models without references", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-sora", status: "queued" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-sora", status: "completed", output: "https://cdn.example.com/sora.mp4" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "sora-2",
            videoSeconds: "4",
            size: "16:9",
        }, "prompt");

        expect(axios.post).toHaveBeenCalledWith(
            "https://api.example.com/v1/videos",
            expect.objectContaining({ model: "sora-2", prompt: "prompt", seconds: "4", size: "1280x720" }),
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer video-key" }) }),
        );
        expect((axios.post as Mock).mock.calls[0][1]).not.toBeInstanceOf(FormData);
        expect(axios.get).toHaveBeenCalledTimes(2);
        expect(axios.get).toHaveBeenNthCalledWith(2, "https://api.example.com/v1/videos/task-sora/content", expect.objectContaining({ responseType: "blob" }));
        expect(fetch).not.toHaveBeenCalled();
    });

    it("uses GeekNow Sora payload shape without unsupported JSON video fields", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-sora", status: "queued" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-sora", status: "completed", video_url: "https://cdn.example.com/sora.mp4" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        const reference = {
            id: "ref-1",
            name: "reference.png",
            type: "image/png",
            dataUrl: "data:image/png;base64,cmVm",
        };

        await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.geeknow.ai/v1",
            videoApiKey: "video-key",
            videoModel: "sora-2",
            videoSeconds: "8",
            vquality: "720",
            size: "16:9",
        }, "prompt", [reference]);

        const body = (axios.post as Mock).mock.calls[0][1];
        expect(body).toEqual({
            model: "sora-2",
            prompt: "prompt",
            size: "1280x720",
            seconds: "8",
            input_reference: "data:image/png;base64,cmVm",
        });
        expect(body).not.toHaveProperty("aspect_ratio");
        expect(body).not.toHaveProperty("resolution");
        expect(body).not.toHaveProperty("generate_audio");
        expect(body).not.toHaveProperty("image_urls");
        expect(body).not.toHaveProperty("image");
    });

    it("normalizes invalid Sora seconds before sending requests", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-sora", status: "queued" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-sora", status: "completed", output: "https://cdn.example.com/sora.mp4" } });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "sora-2",
            videoSeconds: "10",
            size: "16:9",
        }, "prompt");

        expect(axios.post).toHaveBeenCalledWith(
            "https://api.example.com/v1/videos",
            expect.objectContaining({ model: "sora-2", seconds: "8" }),
            expect.any(Object),
        );
    });

    it("keeps authorization when the videos status output points to the content endpoint", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-sora", status: "queued" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-sora", status: "completed", output: "https://api.example.com/v1/videos/task-sora/content" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "sora-2",
        }, "prompt");

        expect(axios.get).toHaveBeenNthCalledWith(
            2,
            "https://api.example.com/v1/videos/task-sora/content",
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer video-key" }), responseType: "blob" }),
        );
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("falls back to direct video url when content download is unavailable", async () => {
        const notFound = Object.assign(new Error("not found"), {
            isAxiosError: true,
            response: { status: 404, data: { error: { message: "not found" } } },
        });
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-sora", status: "queued" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-sora", status: "completed", output: "https://api.example.com/v1/videos/task-sora/content" } });
        (axios.get as Mock).mockRejectedValueOnce(notFound);
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "sora-2",
        }, "prompt");

        expect(fetch).toHaveBeenCalledWith(
            "https://api.example.com/v1/videos/task-sora/content",
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer video-key" }) }),
        );
    });

    it("uses JSON videos endpoint first for Veo models", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-veo", status: "queued" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-veo", status: "completed", video_url: "https://cdn.example.com/veo.mp4" } });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "veo_3_1-fast",
        }, "prompt");

        expect(axios.post).toHaveBeenNthCalledWith(
            1,
            "https://api.example.com/v1/videos",
            expect.objectContaining({ model: "veo_3_1-fast", prompt: "prompt" }),
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer video-key" }) }),
        );
    });

    it("uses standard JSON videos payload for Sora V3 models", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-v3", status: "queued" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-v3", status: "completed", video_url: "https://cdn.example.com/sora-v3.mp4" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        const reference = {
            id: "ref-1",
            name: "reference.png",
            type: "image/png",
            dataUrl: "data:image/png;base64,cmVm",
        };

        await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "sora-v3-fast",
            videoSeconds: "10",
            vquality: "720",
            size: "16:9",
        }, "prompt", [reference]);

        expect(axios.post).toHaveBeenNthCalledWith(
            1,
            "https://api.example.com/v1/videos",
            expect.objectContaining({
                model: "sora-v3-fast",
                prompt: "prompt",
                aspect_ratio: "16:9",
                duration: 10,
                seconds: "10",
                resolution: "720p",
                generate_audio: true,
                image_urls: ["data:image/png;base64,cmVm"],
                image_url: "data:image/png;base64,cmVm",
            }),
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer video-key" }) }),
        );
        expect((axios.post as Mock).mock.calls[0][1]).not.toBeInstanceOf(FormData);
    });

    it("uses standard JSON videos payload for Kling models", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-kling", status: "queued" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-kling", status: "completed", video_url: "https://cdn.example.com/kling.mp4" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "kling-video-o3-omni",
            videoSeconds: "20",
            vquality: "1080",
            size: "1:1",
        }, "prompt");

        expect(axios.post).toHaveBeenNthCalledWith(
            1,
            "https://api.example.com/v1/videos",
            expect.objectContaining({
                model: "kling-video-o3-omni",
                prompt: "prompt",
                aspect_ratio: "1:1",
                duration: 15,
                seconds: "15",
                size: "1024x1024",
                resolution: "1080p",
                generate_audio: true,
            }),
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer video-key" }) }),
        );
    });

    it("uses NewAPI video generations endpoint before legacy videos endpoint", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { data: { task_id: "task-1", status: "queued" } } });
        (axios.get as Mock)
            .mockResolvedValueOnce({ data: { data: { id: "task-1", status: "completed", video_url: "https://cdn.example.com/video.mp4" } } });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        const blob = await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "video-model",
            videoSeconds: "6",
            vquality: "720",
            size: "16:9",
        }, "prompt");

        expect(axios.post).toHaveBeenCalledWith(
            "https://api.example.com/v1/video/generations",
            expect.objectContaining({ model: "video-model", prompt: "prompt" }),
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer video-key" }) }),
        );
        expect(axios.get).toHaveBeenCalledWith(
            "https://api.example.com/v1/video/generations/task-1",
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer video-key" }) }),
        );
        expect(blob.type).toBe("video/mp4");
    });

    it("requires dedicated video API settings instead of falling back to text API", async () => {
        await expect(requestVideoGeneration({
            ...defaultConfig,
            baseUrl: "https://image.example.com/v1",
            apiKey: "image-key",
            textBaseUrl: "https://text.example.com/v1",
            textApiKey: "text-key",
            videoBaseUrl: "",
            videoApiKey: "",
            videoModel: "veo_3_1",
        }, "prompt")).rejects.toThrow("请先在设置里填写支持视频生成的 API URL 和 Key");

        expect(axios.post).not.toHaveBeenCalled();
    });

    it("uses dedicated video API settings even when stale canvas mode is remote", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-video", status: "queued" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-video", status: "completed", video_url: "https://cdn.example.com/video.mp4" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await requestVideoGeneration({
            ...defaultConfig,
            channelMode: "remote",
            videoBaseUrl: "https://api.geeknow.ai/v1",
            videoApiKey: "video-key",
            videoModel: "sora-2",
            videoSeconds: "8",
        }, "prompt");

        expect(axios.post).toHaveBeenNthCalledWith(
            1,
            "https://api.geeknow.ai/v1/videos",
            expect.objectContaining({ model: "sora-2", prompt: "prompt" }),
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer video-key" }) }),
        );
        expect((axios.post as Mock).mock.calls.map((call) => call[0])).not.toContain("/api/v1/videos");
    });

    it("tries task video endpoint for Sora when JSON videos endpoint returns 404", async () => {
        const notFound = Object.assign(new Error("not found"), {
            isAxiosError: true,
            response: { status: 404, data: { error: { message: "not found" } } },
        });
        (axios.post as Mock)
            .mockRejectedValueOnce(notFound)
            .mockResolvedValueOnce({ data: { data: { task_id: "task-2", status: "queued" } } });
        (axios.get as Mock)
            .mockResolvedValueOnce({ data: { data: { id: "task-2", status: "completed", video_url: "https://cdn.example.com/video.mp4" } } });
        vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })))
            .mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "sora-2",
        }, "prompt");

        expect(axios.post).toHaveBeenNthCalledWith(1, "https://api.example.com/v1/videos", expect.any(Object), expect.any(Object));
        expect((axios.post as Mock).mock.calls[0][1]).not.toBeInstanceOf(FormData);
        expect(axios.post).toHaveBeenNthCalledWith(
            2,
            "https://api.example.com/v1/video/generations",
            expect.objectContaining({ model: "sora-2", prompt: "prompt" }),
            expect.any(Object),
        );
    });

    it("tries compatible task endpoint when JSON videos endpoint reports unavailable upstream tokens", async () => {
        const noTokens = Object.assign(new Error("no active tokens available"), {
            isAxiosError: true,
            response: { status: 400, data: { error: { message: "no active tokens available" } } },
        });
        (axios.post as Mock)
            .mockRejectedValueOnce(noTokens)
            .mockResolvedValueOnce({ data: { data: { task_id: "task-compatible", status: "queued" } } });
        (axios.get as Mock)
            .mockResolvedValueOnce({ data: { data: { id: "task-compatible", status: "completed", video_url: "https://cdn.example.com/video.mp4" } } })
            .mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await expect(requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.geeknow.ai/v1",
            videoApiKey: "video-key",
            videoModel: "sora-2",
        }, "prompt")).resolves.toEqual(expect.any(Blob));

        expect(axios.post).toHaveBeenNthCalledWith(1, "https://api.geeknow.ai/v1/videos", expect.any(Object), expect.any(Object));
        expect(axios.post).toHaveBeenNthCalledWith(
            2,
            "https://api.geeknow.ai/v1/video/generations",
            expect.objectContaining({ model: "sora-2", prompt: "prompt" }),
            expect.any(Object),
        );
    });

    it("uses parsed display message to continue after unavailable token errors", async () => {
        const noTokens = Object.assign(new Error("no active tokens available"), {
            isAxiosError: false,
            response: { status: 400, data: { message: "no active tokens available" } },
        });
        (axios.post as Mock)
            .mockRejectedValueOnce(noTokens)
            .mockResolvedValueOnce({ data: { data: { task_id: "task-message", status: "queued" } } });
        (axios.get as Mock)
            .mockResolvedValueOnce({ data: { data: { id: "task-message", status: "completed", video_url: "https://cdn.example.com/video.mp4" } } })
            .mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await expect(requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.geeknow.ai/v1",
            videoApiKey: "video-key",
            videoModel: "sora-2",
        }, "prompt")).resolves.toEqual(expect.any(Blob));

        expect(axios.post).toHaveBeenNthCalledWith(2, "https://api.geeknow.ai/v1/video/generations", expect.any(Object), expect.any(Object));
    });

    it("tries unversioned API root when versioned video root returns 404", async () => {
        const notFound = Object.assign(new Error("not found"), {
            isAxiosError: true,
            response: { status: 404, data: { error: { message: "not found" } } },
        });
        (axios.post as Mock)
            .mockRejectedValueOnce(notFound)
            .mockRejectedValueOnce(notFound)
            .mockRejectedValueOnce(notFound)
            .mockRejectedValueOnce(notFound)
            .mockResolvedValueOnce({ data: { data: { task_id: "task-3", status: "queued" } } });
        (axios.get as Mock)
            .mockResolvedValueOnce({ data: { data: { id: "task-3", status: "completed", video_url: "https://cdn.example.com/video.mp4" } } });
        vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })))
            .mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "veo_3_1",
        }, "prompt");

        expect((axios.post as Mock).mock.calls.map((call) => call[0])).toEqual([
            "https://api.example.com/v1/videos",
            "https://api.example.com/v1/video/generations",
            "https://api.example.com/v1/videos",
            "https://api.example.com/v1/chat/completions",
            "https://api.example.com/videos",
        ]);
    });

    it("does not hide invalid parameter errors behind fallback 404s", async () => {
        const invalidSeconds = Object.assign(new Error("invalid seconds"), {
            isAxiosError: true,
            response: { status: 400, data: { code: "invalid_seconds", message: "oai sora-2 seconds is invalid (must be 4, 8, or 12)" } },
        });
        (axios.post as Mock).mockRejectedValueOnce(invalidSeconds);

        await expect(requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "sora-2",
            videoSeconds: "10",
        }, "prompt")).rejects.toThrow("oai sora-2 seconds is invalid");

        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it("uses JSON videos endpoint with image payload for Sora models with references", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-1", status: "queued" } });
        (axios.get as Mock)
            .mockResolvedValueOnce({ data: { id: "task-1", status: "completed", video_url: "https://cdn.example.com/sora-ref.mp4" } });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        const reference = {
            id: "ref-1",
            name: "reference.png",
            type: "image/png",
            dataUrl: "data:image/png;base64,cmVm",
        };

        await requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "sora-2",
            videoSeconds: "6",
            vquality: "720",
            size: "16:9",
        }, "prompt", [reference]);

        const [url, body] = (axios.post as Mock).mock.calls[0];
        expect(url).toBe("https://api.example.com/v1/videos");
        expect(body).toEqual({
            model: "sora-2",
            prompt: "prompt",
            seconds: "8",
            size: "1280x720",
            input_reference: "data:image/png;base64,cmVm",
        });
        expect(axios.get).toHaveBeenNthCalledWith(
            1,
            "https://api.example.com/v1/videos/task-1",
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer video-key" }) }),
        );
        expect(fetch).toHaveBeenCalledWith("https://cdn.example.com/sora-ref.mp4", expect.any(Object));
    });

    it("uses Pixelle JSON fields for Seedance 2 image and audio references", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-seedance", status: "queued" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-seedance", status: "completed", video_url: "https://cdn.example.com/seedance.mp4" } });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await requestVideoGeneration(
            {
                ...defaultConfig,
                videoBaseUrl: "https://api.example.com/v1",
                videoApiKey: "video-key",
                videoModel: "Seedance-2-mini",
                videoSeconds: "10",
                vquality: "720",
                size: "21:9",
            },
            "prompt",
            [
                { id: "ref-1", name: "ref1.png", type: "image/png", dataUrl: "data:image/png;base64,cmVmMQ==" },
                { id: "ref-2", name: "ref2.png", type: "image/png", dataUrl: "data:image/png;base64,cmVmMg==" },
            ],
            [{ id: "audio-1", name: "audio.mp3", type: "audio/mpeg", url: "data:audio/mpeg;base64,YXVkaW8=" }],
        );

        const [url, body] = (axios.post as Mock).mock.calls[0];
        expect(url).toBe("https://api.example.com/v1/videos");
        expect(body).toEqual(expect.objectContaining({
            model: "Seedance-2-mini",
            prompt: "prompt",
            aspect_ratio: "21:9",
            duration: 10,
            seconds: "10",
            resolution: "720p",
            image_url: "data:image/png;base64,cmVmMQ==",
            reference_image_urls: ["data:image/png;base64,cmVmMg=="],
            image_urls: ["data:image/png;base64,cmVmMQ==", "data:image/png;base64,cmVmMg=="],
            audio_url: "data:audio/mpeg;base64,YXVkaW8=",
        }));
        expect(body).not.toHaveProperty("image");
        expect(body).not.toHaveProperty("input_reference");
    });

    it("passes HTTP audio references for Seedance models without rewriting the URL", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "task-seedance-audio", status: "queued" } });
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "task-seedance-audio", status: "completed", video_url: "https://cdn.example.com/seedance-audio.mp4" } });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await requestVideoGeneration(
            {
                ...defaultConfig,
                videoBaseUrl: "https://api.example.com/v1",
                videoApiKey: "video-key",
                videoModel: "Seedance-2-fast",
                videoSeconds: "10",
                vquality: "720",
                size: "16:9",
            },
            "prompt",
            [{ id: "ref-1", name: "ref1.png", type: "image/png", dataUrl: "data:image/png;base64,cmVmMQ==" }],
            [{ id: "audio-1", name: "audio.mp3", type: "audio/mpeg", url: "https://cdn.example.com/audio.mp3", duration: 8 }],
        );

        expect((axios.post as Mock).mock.calls[0][1]).toEqual(expect.objectContaining({
            model: "Seedance-2-fast",
            image_url: "data:image/png;base64,cmVmMQ==",
            audio_url: "https://cdn.example.com/audio.mp3",
        }));
    });

    it("requires an image reference when sending audio references to Seedance models", async () => {
        await expect(requestVideoGeneration(
            {
                ...defaultConfig,
                videoBaseUrl: "https://api.example.com/v1",
                videoApiKey: "video-key",
                videoModel: "Seedance-2-fast",
            },
            "prompt",
            [],
            [{ id: "audio-1", name: "audio.mp3", type: "audio/mpeg", url: "https://cdn.example.com/audio.mp3", duration: 8 }],
        )).rejects.toThrow("视频参考音频必须同时连接至少一张参考图");

        expect(axios.post).not.toHaveBeenCalled();
    });

    it("rejects audio references outside the documented duration range", async () => {
        await expect(requestVideoGeneration(
            {
                ...defaultConfig,
                videoBaseUrl: "https://api.example.com/v1",
                videoApiKey: "video-key",
                videoModel: "Seedance-2-fast",
            },
            "prompt",
            [{ id: "ref-1", name: "ref1.png", type: "image/png", dataUrl: "data:image/png;base64,cmVmMQ==" }],
            [{ id: "audio-1", name: "audio.mp3", type: "audio/mpeg", url: "https://cdn.example.com/audio.mp3", duration: 16 }],
        )).rejects.toThrow("视频参考音频时长需要大于 2 秒且小于 15 秒");

        expect(axios.post).not.toHaveBeenCalled();
    });

    it("reads nested NewAPI video result url", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { data: { task_id: "task-2", status: "queued" } } });
        (axios.get as Mock)
            .mockResolvedValueOnce({ data: { data: { id: "task-2", status: "completed", result: { video_url: "https://cdn.example.com/nested.mp4" } } } });
        (axios.get as Mock).mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await expect(requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "video-model",
        }, "prompt")).resolves.toEqual(expect.any(Blob));
    });

    it("reads NewAPI result_url and downloads through content endpoint first", async () => {
        (axios.post as Mock).mockResolvedValueOnce({ data: { data: { task_id: "task-4", status: "IN_PROGRESS" } } });
        (axios.get as Mock)
            .mockResolvedValueOnce({ data: { data: { task_id: "task-4", status: "SUCCESS", result_url: "https://cdn.example.com/result.mp4" } } })
            .mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Blob(["video"], { type: "video/mp4" })));

        await expect(requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "video-model",
        }, "prompt")).resolves.toEqual(expect.any(Blob));

        expect(axios.get).toHaveBeenNthCalledWith(
            2,
            "https://api.example.com/v1/videos/task-4/content",
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer video-key" }), responseType: "blob" }),
        );
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("does not use image API settings as a silent video fallback", async () => {
        await expect(requestVideoGeneration({
            ...defaultConfig,
            baseUrl: "https://image.example.com/v1",
            apiKey: "image-key",
            videoBaseUrl: "",
            videoApiKey: "",
            textBaseUrl: "",
            textApiKey: "",
            textVideoBaseUrl: "",
            textVideoApiKey: "",
            videoModel: "sora-2",
        }, "prompt")).rejects.toThrow("请先在设置里填写支持视频生成的 API URL 和 Key");

        expect(axios.post).not.toHaveBeenCalled();
    });

    it("shows the video source and model when a single source fails", async () => {
        const upstreamError = Object.assign(new Error("bad request"), {
            isAxiosError: true,
            response: { status: 400, data: { message: "模型暂不可用" } },
        });
        (axios.post as Mock).mockRejectedValueOnce(upstreamError);

        await expect(requestVideoGeneration({
            ...defaultConfig,
            videoBaseUrl: "https://api.example.com/v1",
            videoApiKey: "video-key",
            videoModel: "grok-video-3-pro",
        }, "prompt")).rejects.toThrow("视频 API https://api.example.com/v1 [grok-video-3-pro，直连] OpenAI multipart /videos：模型暂不可用");
    });
});
