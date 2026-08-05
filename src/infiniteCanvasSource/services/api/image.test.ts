import { afterEach, describe, expect, it, vi } from "vitest";
import axios from "axios";

import { DEFAULT_SETTINGS, LOCKED_PUBLIC_PROFILE_ID } from "../../../lib/apiProfiles";
import { useStore } from "../../../store";
import { defaultConfig } from "../../stores/use-config-store";
import { requestEdit, requestGeneration, requestImageQuestion } from "./image";

describe("canvas image api", () => {
    const initialSettings = useStore.getState().settings;

    afterEach(() => {
        useStore.setState({ settings: initialSettings });
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        vi.stubEnv("VITE_IMAGE_TASKS_AVAILABLE", "disabled");
    });

    it("uses the same locked image API direct URL as the main workshop", async () => {
        vi.stubEnv("VITE_API_PROXY_AVAILABLE", "true");
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ data: [{ b64_json: "ZmluYWw=" }] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        useStore.setState({
            settings: {
                ...DEFAULT_SETTINGS,
                profiles: DEFAULT_SETTINGS.profiles.map((profile, index) => ({
                    ...profile,
                    apiKey: "test-key",
                    apiProxy: index === 0,
                    responseFormatB64Json: false,
                })),
            },
        });

        const images = await requestGeneration(
            {
                ...defaultConfig,
                baseUrl: "",
                apiKey: "test-key",
                model: "gpt-image-2",
                imageModel: "gpt-image-2",
                size: "1:1",
                quality: "auto",
                count: "1",
            },
            "prompt",
        );

        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.zzlye.xyz/v1/images/generations",
            expect.objectContaining({ method: "POST" }),
        );
        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(String((init as RequestInit).body));
        expect(body.quality).toBe("auto");
        expect(body.size).toBe("1024x1024");
        expect(body.response_format).toBe("b64_json");
        expect(images).toEqual([{ id: expect.any(String), dataUrl: "data:image/png;base64,ZmluYWw=" }]);
    });

    it("keeps selected canvas image quality when building image requests", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ data: [{ b64_json: "ZmluYWw=" }] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        useStore.setState({
            settings: {
                ...DEFAULT_SETTINGS,
                profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
                    ...profile,
                    apiKey: "test-key",
                })),
            },
        });

        await requestGeneration(
            {
                ...defaultConfig,
                baseUrl: "",
                apiKey: "test-key",
                model: "gpt-image-2",
                imageModel: "gpt-image-2",
                size: "1:1",
                quality: "high",
                count: "1",
            },
            "prompt",
        );

        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(String((init as RequestInit).body));
        expect(body.quality).toBe("high");
        expect(body.size).toBe("2880x2880");
    });

    it("uses the active settings profile token after switching sites instead of stale canvas config", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ data: [{ b64_json: "ZmluYWw=" }] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );

        useStore.setState({
            settings: {
                ...DEFAULT_SETTINGS,
                activeProfileId: LOCKED_PUBLIC_PROFILE_ID,
                profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
                    ...profile,
                    apiKey: profile.id === LOCKED_PUBLIC_PROFILE_ID ? "public-key" : "wenyun-key",
                })),
            },
        });

        await requestGeneration(
            {
                ...defaultConfig,
                baseUrl: "https://api.zzlye.xyz/v1",
                apiKey: "wenyun-key",
                model: "gpt-image-2",
                imageModel: "gpt-image-2",
                size: "1:1",
                quality: "auto",
                count: "1",
            },
            "prompt",
        );

        const [, init] = fetchMock.mock.calls[0];
        expect(String(fetchMock.mock.calls[0][0])).toBe("https://1520635.xyz:3901/v1/images/generations");
        expect((init as RequestInit).headers).toMatchObject({
            Authorization: "Bearer public-key",
        });
    });

    it("uses text API settings for canvas text nodes even when stale canvas mode is remote", async () => {
        const postMock = vi.spyOn(axios, "post").mockResolvedValue({ data: "" });
        const onDelta = vi.fn();

        await requestImageQuestion(
            {
                ...defaultConfig,
                channelMode: "remote",
                baseUrl: "https://image.example.com/v1",
                apiKey: "image-key",
                textBaseUrl: "https://text.example.com/v1",
                textApiKey: "text-key",
                textModel: "text-model",
            },
            [{ role: "user", content: "识别图片" }],
            onDelta,
        );

        expect(postMock).toHaveBeenCalledWith(
            "https://text.example.com/v1/chat/completions",
            expect.objectContaining({ model: "text-model" }),
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer text-key" }) }),
        );
        expect(postMock.mock.calls.map((call) => call[0])).not.toContain("/api/v1/chat/completions");
    });

    it("requires text API settings for canvas text nodes instead of falling back to image API", async () => {
        await expect(requestImageQuestion(
            {
                ...defaultConfig,
                baseUrl: "https://image.example.com/v1",
                apiKey: "image-key",
                textBaseUrl: "",
                textApiKey: "",
                textVideoBaseUrl: "https://legacy-text-video.example.com/v1",
                textVideoApiKey: "legacy-key",
                textModel: "text-model",
            },
            [{ role: "user", content: "识别图片" }],
            vi.fn(),
        )).rejects.toThrow("请先在设置里填写文字 API URL 和 Key");
    });

    it.each([
        ["文运站 Banana 2", "Nano-Banana-2", "nano-banana-2"],
        ["文运站 Banana Pro", "Nano-Banana-Pro", "nano-banana-pro"],
    ])("routes %s canvas image edits through standard NewAPI edits like public site", async (
        _label,
        model,
        requestModel,
    ) => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url.startsWith("data:")) return new Response(new Blob(["ref"], { type: "image/png" }));
            return new Response(JSON.stringify({ data: [{ b64_json: "ZWRpdGVk" }] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        });

        useStore.setState({
            settings: {
                ...DEFAULT_SETTINGS,
                profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
                    ...profile,
                    apiKey: "test-key",
                    model,
                    responseFormatB64Json: false,
                })),
            },
        });

        const images = await requestEdit(
            {
                ...defaultConfig,
                baseUrl: "https://api.example.com/v1",
                apiKey: "test-key",
                model,
                imageModel: model,
                size: "16:9",
                quality: "2k",
                count: "1",
            },
            "帮我美化封面",
            [{ id: "ref-1", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,cmVm" }],
        );

        const apiCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/images/edits"));
        expect(apiCall).toBeTruthy();
        const [url, init] = apiCall!;
        const formData = (init as RequestInit).body as FormData;
        expect(String(url)).toBe("https://api.zzlye.xyz/v1/images/edits");
        expect(formData.get("model")).toBe(requestModel);
        expect(formData.get("prompt")).toBe("帮我美化封面");
        expect(formData.get("aspectRatio")).toBeNull();
        expect(formData.get("imageSize")).toBeNull();
        expect(formData.get("replyType")).toBeNull();
        expect(formData.get("response_format")).toBe("b64_json");
        expect(formData.getAll("image")).toHaveLength(1);
        expect(images).toEqual([{ id: expect.any(String), dataUrl: "data:image/png;base64,ZWRpdGVk" }]);
    });

    it.each([
        ["公益站 Banana 2", "Nano-Banana-2", "nano-banana-2"],
        ["公益站 Banana Pro", "Nano-Banana-Pro", "nano-banana-pro"],
    ])("routes %s canvas image edits through standard NewAPI edits without changing site URL", async (
        _label,
        model,
        requestModel,
    ) => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url.startsWith("data:")) return new Response(new Blob(["ref"], { type: "image/png" }));
            return new Response(JSON.stringify({ data: [{ b64_json: "ZWRpdGVk" }] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        });

        useStore.setState({
            settings: {
                ...DEFAULT_SETTINGS,
                activeProfileId: LOCKED_PUBLIC_PROFILE_ID,
                profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
                    ...profile,
                    apiKey: "test-key",
                    model,
                })),
            },
        });

        const images = await requestEdit(
            {
                ...defaultConfig,
                baseUrl: "https://1520635.xyz:3901/v1",
                apiKey: "test-key",
                model,
                imageModel: model,
                size: "16:9",
                quality: "1k",
                count: "1",
            },
            "帮我美化封面",
            [{ id: "ref-1", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,cmVm" }],
        );

        const apiCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/images/edits"));
        expect(apiCall).toBeTruthy();
        const [url, init] = apiCall!;
        const formData = (init as RequestInit).body as FormData;
        expect(String(url)).toBe("https://1520635.xyz:3901/v1/images/edits");
        expect(formData.get("model")).toBe(requestModel);
        expect(formData.get("prompt")).toBe("帮我美化封面");
        expect(formData.get("aspectRatio")).toBeNull();
        expect(formData.get("imageSize")).toBeNull();
        expect(formData.get("replyType")).toBeNull();
        expect(formData.getAll("image")).toHaveLength(1);
        expect(images).toEqual([{ id: expect.any(String), dataUrl: "data:image/png;base64,ZWRpdGVk" }]);
    });
});
