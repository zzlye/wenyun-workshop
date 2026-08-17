import { describe, expect, it } from "vitest";

import { normalizeVideoResolutionValue, normalizeVideoSecondsForModel, normalizeVideoSizeValue } from "./video-settings-panel";

describe("Seedance 视频参数", () => {
    it("按照模型固定清晰度并限制时长范围", () => {
        expect(normalizeVideoResolutionValue("720", "seedance-2.0-1080p")).toBe("1080");
        expect(normalizeVideoResolutionValue("720", "seedance-2.0-mini-431-480p")).toBe("480");
        expect(normalizeVideoSecondsForModel("6", "seedance-2.0-720p")).toBe("6");
        expect(normalizeVideoSecondsForModel("15", "旧模型")).toBe("15");
        expect(normalizeVideoSecondsForModel("29", "seedance-2.5-720p")).toBe("29");
        expect(normalizeVideoSecondsForModel("30", "seedance-2.5-720p")).toBe("29");
    });

    it("只保留接口文档支持的六种画面比例", () => {
        expect(normalizeVideoSizeValue("16:9")).toBe("1280x720");
        expect(normalizeVideoSizeValue("9:16")).toBe("720x1280");
        expect(normalizeVideoSizeValue("4:3", "seedance-2.0-720p")).toBe("1024x768");
        expect(normalizeVideoSizeValue("3:4", "seedance-2.0-720p")).toBe("768x1024");
        expect(normalizeVideoSizeValue("1:1", "seedance-2.0-720p")).toBe("1024x1024");
        expect(normalizeVideoSizeValue("21:9", "seedance-2.0-720p")).toBe("1680x720");
        expect(normalizeVideoSizeValue("4:3", "seedance-2.5-720p")).toBe("1280x720");
        expect(normalizeVideoSizeValue("auto", "seedance-2.0-720p")).toBe("1280x720");
    });

    it("Kling 只显示 16:9、9:16 和 5/10/15 秒", () => {
        expect(normalizeVideoSecondsForModel("4", "kling-3.0-omni-720p")).toBe("5");
        expect(normalizeVideoSecondsForModel("8", "kling-3.0-omni-1080p")).toBe("10");
        expect(normalizeVideoSecondsForModel("20", "kling-3.0-omni-1080p")).toBe("15");
        expect(normalizeVideoSizeValue("16:9", "kling-3.0-omni-720p")).toBe("1280x720");
        expect(normalizeVideoSizeValue("9:16", "kling-3.0-omni-720p")).toBe("720x1280");
        expect(normalizeVideoSizeValue("4:3", "kling-3.0-omni-720p")).toBe("1280x720");
    });
});
