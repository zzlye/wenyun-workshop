import { describe, expect, it } from "vitest";

import { CANVAS_VIDEO_BASE_URL, CANVAS_VIDEO_MODEL, isCanvasVideoKlingModel, normalizeCanvasVideoKlingSeconds, normalizeCanvasVideoModel } from "./videoModel";

describe("画布视频模型列表", () => {
    it("固定使用站点 NewAPI 地址", () => {
        expect(CANVAS_VIDEO_BASE_URL).toBe("https://api.zzlye.xyz/v1");
    });

    it("保留 API 返回的新模型与历史节点模型，不再按白名单替换", () => {
        expect(normalizeCanvasVideoModel("sd-2.0-933-720p")).toBe("sd-2.0-933-720p");
        expect(normalizeCanvasVideoModel("  api-video-model-v3  ")).toBe("api-video-model-v3");
        expect(normalizeCanvasVideoModel("sora-2")).toBe("sora-2");
    });

    it("仅空配置使用默认模型", () => {
        for (const model of [undefined, null, "", "  "]) {
            expect(normalizeCanvasVideoModel(model)).toBe(CANVAS_VIDEO_MODEL);
        }
    });

    it("识别 Kling Omni 并只允许文档规定的时长", () => {
        expect(isCanvasVideoKlingModel("kling-3.0-omni-720p")).toBe(true);
        expect(isCanvasVideoKlingModel("seedance-2.0-720p")).toBe(false);
        expect(normalizeCanvasVideoKlingSeconds("4")).toBe(5);
        expect(normalizeCanvasVideoKlingSeconds("8")).toBe(10);
        expect(normalizeCanvasVideoKlingSeconds("20")).toBe(15);
    });
});
