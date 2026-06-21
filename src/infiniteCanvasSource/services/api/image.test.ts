import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, LOCKED_PUBLIC_PROFILE_ID } from "../../../lib/apiProfiles";
import { useStore } from "../../../store";
import { defaultConfig } from "../../stores/use-config-store";
import { requestEdit, requestGeneration } from "./image";

describe("canvas image api", () => {
    const initialSettings = useStore.getState().settings;

    afterEach(() => {
        useStore.setState({ settings: initialSettings });
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it("uses the same image API proxy path as the main workshop", async () => {
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
            "/api-proxy/wenyun/images/generations",
            expect.objectContaining({ method: "POST" }),
        );
        expect(images).toEqual([{ id: expect.any(String), dataUrl: "data:image/png;base64,ZmluYWw=" }]);
    });

    it.each([
        ["文运站 Banana 2", undefined, "Nano-Banana-2", "nano-banana-2", "/api-proxy/wenyun/images/edits", "2k"],
        ["文运站 Banana Pro", undefined, "Nano-Banana-Pro", "nano-banana-pro", "/api-proxy/wenyun/images/edits", "2k"],
        ["公益站 Banana 2", LOCKED_PUBLIC_PROFILE_ID, "Nano-Banana-2", "nano-banana-2", "/api-proxy/public/images/edits", "1k"],
        ["公益站 Banana Pro", LOCKED_PUBLIC_PROFILE_ID, "Nano-Banana-Pro", "nano-banana-pro", "/api-proxy/public/images/edits", "1k"],
    ])("routes %s canvas image edits through standard NewAPI edits without changing site URL", async (
        _label,
        activeProfileId,
        model,
        requestModel,
        expectedUrl,
        quality,
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
                ...(activeProfileId ? { activeProfileId } : {}),
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
                baseUrl: activeProfileId ? "https://1520635.xyz:3901/v1" : "https://api.example.com/v1",
                apiKey: "test-key",
                model,
                imageModel: model,
                size: "16:9",
                quality,
                count: "1",
            },
            "帮我美化封面",
            [{ id: "ref-1", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,cmVm" }],
        );

        const apiCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/images/edits"));
        expect(apiCall).toBeTruthy();
        const [url, init] = apiCall!;
        const formData = (init as RequestInit).body as FormData;
        expect(String(url)).toBe(expectedUrl);
        expect(formData.get("model")).toBe(requestModel);
        expect(formData.get("prompt")).toBe("帮我美化封面");
        expect(formData.get("aspectRatio")).toBe("16:9");
        expect(formData.get("imageSize")).toBe(quality === "2k" ? "2K" : "1K");
        expect(formData.get("replyType")).toBe("json");
        expect(formData.getAll("image[]")).toHaveLength(1);
        expect(images).toEqual([{ id: expect.any(String), dataUrl: "data:image/png;base64,ZWRpdGVk" }]);
    });
});
