import { describe, expect, it } from "vitest";

import { CANVAS_VIDEO_BASE_URL, CANVAS_VIDEO_MODELS, isCanvasVideoKlingModel, normalizeCanvasVideoKlingSeconds, normalizeCanvasVideoModel } from "./videoModel";

describe("画布视频模型列表", () => {
    it("固定使用站点 NewAPI 地址", () => {
        expect(CANVAS_VIDEO_BASE_URL).toBe("https://api.zzlye.xyz/v1");
    });

    it("保留文档中的可用模型并排除红框和未公开模型", () => {
        expect(CANVAS_VIDEO_MODELS).toEqual([
            "seedance-2.0-mini-431-720p",
            "seedance-2.0-mini-431-480p",
            "seedance-2.0-1080p",
            "seedance-2.0-720p",
            "seedance-2.0-fast-720p",
            "sd-2.5-720p",
            "seedance-2.5-720p",
            "seedance-2.5-480p",
            "kling-3.0-omni-720p",
            "kling-3.0-omni-1080p",
        ]);
        expect(CANVAS_VIDEO_MODELS).not.toContain("sd-2.0-933-720p");
        expect(CANVAS_VIDEO_MODELS).not.toContain("sd-2.0-933-480p");
    });

    it("历史模型配置会回退到默认可用模型", () => {
        expect(normalizeCanvasVideoModel("sd-2.0-933-720p")).toBe("seedance-2.0-720p");
        expect(normalizeCanvasVideoModel("unknown-video-model")).toBe("seedance-2.0-720p");
    });

    it("识别 Kling Omni 并只允许文档规定的时长", () => {
        expect(isCanvasVideoKlingModel("kling-3.0-omni-720p")).toBe(true);
        expect(isCanvasVideoKlingModel("seedance-2.0-720p")).toBe(false);
        expect(normalizeCanvasVideoKlingSeconds("4")).toBe(5);
        expect(normalizeCanvasVideoKlingSeconds("8")).toBe(10);
        expect(normalizeCanvasVideoKlingSeconds("20")).toBe(15);
    });
});
