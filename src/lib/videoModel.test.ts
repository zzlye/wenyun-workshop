import { describe, expect, it } from "vitest";

import { CANVAS_VIDEO_BASE_URL, CANVAS_VIDEO_MODEL, normalizeCanvasVideoDuration, normalizeCanvasVideoResolution, normalizeCanvasVideoModel } from "./videoModel";

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

    it.each([
        ["", 10], ["NaN", 10], ["Infinity", 10], ["0", 1], ["-10", 1],
        ["1", 1], ["8", 8], ["23", 23], ["29.8", 30], ["30", 30], ["31", 30],
    ])("统一校验时长 %s 为 %s 秒", (value, expected) => {
        expect(normalizeCanvasVideoDuration(value)).toBe(expected);
    });

    it.each([
        ["480", "480"], ["720", "720"], ["1080", "1080"], [" 1080P ", "1080"],
        ["", "720"], ["2160", "720"],
    ])("统一校验清晰度 %s 为 %s", (value, expected) => {
        expect(normalizeCanvasVideoResolution(value)).toBe(expected);
    });
});
