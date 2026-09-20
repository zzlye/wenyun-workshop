import { describe, expect, it } from "vitest";
import { mergeVideoParameterDefinitions, videoSelectionError, type VideoCapabilityResponse } from "./videoCapabilities";

describe("跨渠道自定义参数", () => {
    it("合并同类型枚举但不混淆不同类型，不让一个渠道的范围覆盖另一个", () => {
        const groups = mergeVideoParameterDefinitions([
            {
                duration: {},
                parameters: [
                    { key: "camera", label: "镜头", type: "string", editable: true, options: ["static"] },
                    { key: "seed", label: "种子", type: "integer", editable: true, min: 1, max: 10 },
                ],
            },
            {
                duration: {},
                parameters: [
                    { key: "camera", label: "镜头", type: "string", editable: true, options: ["zoom"] },
                    { key: "seed", label: "种子", type: "integer", editable: true, min: 0, max: 20 },
                    { key: "camera", label: "镜头", type: "integer", editable: true, options: [0, 1] },
                ],
            },
        ]);
        expect(groups.find((p) => p.key === "camera")?.definitions).toHaveLength(2);
        expect(groups.find((p) => p.key === "camera")?.definitions[0].options).toEqual(["static", "zoom"]);
        expect(groups.find((p) => p.key === "seed")?.definitions[0]).toMatchObject({ min: 0, max: 20 });
    });
});

describe("视频能力组合", () => {
    it("自动模式先按连接素材确定用途，再匹配组合限制", () => {
        expect(
            videoSelectionError(
                {
                    model: "reference-only",
                    version: 1,
                    configured: true,
                    variants: [{ duration: {}, combinations: [{ duration: {}, modes: ["references"] }] }],
                },
                { mode: "auto", imageCount: 1 },
            ),
        ).toBeNull();
    });
    const capabilities: VideoCapabilityResponse = {
        model: "same-model",
        version: 1,
        configured: true,
        variants: [
            { duration: { min: 1, max: 30 }, resolutions: ["720p"] },
            { duration: { min: 1, max: 10 }, resolutions: ["4k"] },
        ],
    };
    it("不同渠道的能力不能拼接为无人支持的组合", () => {
        expect(videoSelectionError(capabilities, { duration: 30, resolution: "4k" })).toBeTruthy();
        expect(videoSelectionError(capabilities, { duration: 30, resolution: "720p" })).toBeNull();
        expect(videoSelectionError(capabilities, { duration: 5, resolution: "4k" })).toBeNull();
    });
    it("保留首帧加视频例外，同时拒绝尾帧混用及音频", () => {
        const omni: VideoCapabilityResponse = {
            ...capabilities,
            variants: [{ duration: {}, first_frame_with_video: true, audio_limit: 0, prompt_optional_with_image: true }],
        };
        expect(videoSelectionError(omni, { mode: "frames", imageCount: 1, videoCount: 1, prompt: "" })).toBeNull();
        expect(videoSelectionError(omni, { mode: "frames", imageCount: 2, videoCount: 1 })).toBeTruthy();
        expect(videoSelectionError(omni, { audioCount: 1 })).toBeTruthy();
    });
    it("新增参数定义可校验显式 false 和零值，无须模型专用代码", () => {
        const custom: VideoCapabilityResponse = {
            ...capabilities,
            variants: [
                {
                    duration: {},
                    parameters: [
                        { key: "music", label: "音乐", type: "boolean", editable: true },
                        { key: "seed", label: "种子", type: "integer", editable: true, min: 0 },
                    ],
                },
            ],
        };
        expect(videoSelectionError(custom, { extra_parameters: { music: false, seed: 0 } })).toBeNull();
        expect(videoSelectionError(custom, { extra_parameters: { secret: "value" } })).toBeTruthy();
    });
});
