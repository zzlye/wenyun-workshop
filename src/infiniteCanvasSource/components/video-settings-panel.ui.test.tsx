// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoSettingsPanel } from "./video-settings-panel";
import { defaultConfig } from "../stores/use-config-store";
import { canvasThemes } from "../lib/canvas-theme";
import { useVideoCapabilities } from "../../hooks/useVideoCapabilities";
import type { VideoCapabilityResponse } from "../../lib/videoCapabilities";

vi.mock("../../hooks/useVideoCapabilities", () => ({ useVideoCapabilities: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let cleanup = () => {};
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
async function render(data: VideoCapabilityResponse, media?: { imageCount: number; videoCount: number; audioCount: number }) {
    vi.mocked(useVideoCapabilities).mockReturnValue({ data, isFetching: false, isError: false } as ReturnType<typeof useVideoCapabilities>);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Form() {
        const [config, setConfig] = useState({
            ...defaultConfig,
            videoApiKey: "fixture",
            videoSeconds: "30",
            vquality: "720",
            size: "16:9",
        });
        return (
            <VideoSettingsPanel
                config={config}
                media={media}
                onConfigChange={(key, value) => setConfig((v) => ({ ...v, [key]: value }))}
                theme={canvasThemes.dark}
            />
        );
    }
    await act(async () => root.render(<Form />));
    cleanup = () => {
        act(() => root.unmount());
        host.remove();
    };
    return host;
}
describe("动态视频控件", () => {
    it("合并镜头枚举并根据完整组合禁用不兼容项", async () => {
        const host = await render({
            model: "多渠道",
            version: 1,
            configured: true,
            variants: [
                {
                    duration: { max: 30 },
                    parameters: [{ key: "camera", label: "镜头", type: "string", editable: true, options: ["static"] }],
                },
                {
                    duration: { max: 10 },
                    parameters: [{ key: "camera", label: "镜头", type: "string", editable: true, options: ["zoom"] }],
                },
            ],
        });
        const camera = host.querySelector<HTMLSelectElement>('[aria-label="镜头"]')!;
        expect(Array.from(camera.options).map((o) => o.value)).toEqual(["", '"static"', '"zoom"']);
        expect(camera.options[2].disabled).toBe(true);
    });
    it("三张连接图片时禁止首尾帧和文生视频，保留多参考模式", async () => {
        const host = await render(
            { model: "多参考", version: 1, configured: true, variants: [{ duration: {}, modes: ["text", "references", "frames"] }] },
            { imageCount: 3, videoCount: 0, audioCount: 0 },
        );
        const modes = host.querySelector<HTMLSelectElement>('[aria-label="生成模式"]')!;
        expect(Array.from(modes.options).find((o) => o.value === "text")?.disabled).toBe(true);
        expect(Array.from(modes.options).find((o) => o.value === "frames")?.disabled).toBe(true);
        expect(Array.from(modes.options).find((o) => o.value === "references")?.disabled).toBe(false);
    });
    it("保持完整渠道组合并动态出现未来模型的新参数", async () => {
        const host = await render({
            model: "未来模型",
            version: 3,
            configured: true,
            variants: [
                {
                    duration: { max: 30 },
                    resolutions: ["720p"],
                    generate_audio: true,
                    parameters: [{ key: "music", label: "音乐", type: "boolean", editable: true }],
                },
                {
                    duration: { max: 10 },
                    resolutions: ["4k"],
                    generate_audio: true,
                    parameters: [{ key: "music", label: "音乐", type: "boolean", editable: true }],
                },
            ],
        });
        const fourK = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "4K")!;
        expect(fourK.disabled).toBe(true);
        const ten = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "10s")!;
        await act(async () => ten.click());
        expect(fourK.disabled).toBe(false);
        const music = host.querySelector<HTMLSelectElement>('[aria-label="音乐"]')!;
        expect(music).toBeTruthy();
        await act(async () => {
            music.value = "false";
            music.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(music.value).toBe("false");
        const audio = host.querySelector<HTMLSelectElement>('[aria-label="生成音频"]')!;
        expect(audio.options.length).toBe(3);
    });
    it("模型切换导致失效时保留30秒，用户仍可修正", async () => {
        const host = await render({
            model: "短视频",
            version: 1,
            configured: true,
            variants: [{ duration: { values: [5, 10] }, resolutions: ["480p"] }],
        });
        expect(host.querySelector<HTMLInputElement>('[aria-label="视频时长（秒）"]')?.value).toBe("30");
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("无兼容渠道");
        const five = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "5s")!;
        expect(five.disabled).toBe(false);
    });
});
