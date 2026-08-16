import { describe, expect, it } from "vitest";

import { CANVAS_VIDEO_MODELS, normalizeCanvasVideoModel } from "./videoModel";

describe("画布视频模型列表", () => {
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
        ]);
        expect(CANVAS_VIDEO_MODELS).not.toContain("sd-2.0-933-720p");
        expect(CANVAS_VIDEO_MODELS).not.toContain("sd-2.0-933-480p");
        expect(CANVAS_VIDEO_MODELS).not.toContain("sd-2.5-480p");
    });

    it("历史模型配置会回退到默认可用模型", () => {
        expect(normalizeCanvasVideoModel("sd-2.0-933-720p")).toBe("seedance-2.0-720p");
        expect(normalizeCanvasVideoModel("sd-2.5-480p")).toBe("seedance-2.0-720p");
    });
});
