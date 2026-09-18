import { describe, expect, it } from "vitest";

import { normalizeVideoResolutionValue, normalizeVideoSecondsForModel, normalizeVideoSizeValue } from "./video-settings-panel";

describe("统一视频参数", () => {
    it.each(["wan-3.0", "seedance-2.0-1080p", "seedance-2.0-mini-431-480p", "seedance-2.5-720p", "kling-3.0-omni-1080p", "api-new-model"])("%s 保留用户清晰度、时长和比例", (model) => {
        for (const resolution of ["480", "720", "1080"]) {
            expect(normalizeVideoResolutionValue(resolution, model)).toBe(resolution);
        }
        for (const seconds of ["1", "4", "8", "23", "30"]) {
            expect(normalizeVideoSecondsForModel(seconds, model)).toBe(seconds);
        }
        expect(normalizeVideoSizeValue("4:3", model)).toBe("1024x768");
        expect(normalizeVideoSizeValue("21:9", model)).toBe("1680x720");
    });

    it("沿用六种画面比例并兼容历史像素尺寸", () => {
        expect(normalizeVideoSizeValue("16:9")).toBe("1280x720");
        expect(normalizeVideoSizeValue("9:16")).toBe("720x1280");
        expect(normalizeVideoSizeValue("4:3", "seedance-2.0-720p")).toBe("1024x768");
        expect(normalizeVideoSizeValue("3:4", "seedance-2.0-720p")).toBe("768x1024");
        expect(normalizeVideoSizeValue("1:1", "seedance-2.0-720p")).toBe("1024x1024");
        expect(normalizeVideoSizeValue("21:9", "seedance-2.0-720p")).toBe("1680x720");
        expect(normalizeVideoSizeValue("4:3", "seedance-2.5-720p")).toBe("1024x768");
        expect(normalizeVideoSizeValue("1920x1080")).toBe("1280x720");
        expect(normalizeVideoSizeValue("0x0")).toBe("1280x720");
        expect(normalizeVideoSizeValue("auto", "seedance-2.0-720p")).toBe("1280x720");
    });
});
