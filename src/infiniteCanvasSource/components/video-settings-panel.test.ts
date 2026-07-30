import { describe, expect, it } from "vitest";

import { normalizeVideoResolutionValue, normalizeVideoSecondsForModel, normalizeVideoSizeValue } from "./video-settings-panel";

describe("Seedance 2.0 视频参数", () => {
    it("固定清晰度并把旧秒数迁移到 10 或 15 秒", () => {
        expect(normalizeVideoResolutionValue("1080", "旧模型")).toBe("720");
        expect(normalizeVideoSecondsForModel("6", "旧模型")).toBe("10");
        expect(normalizeVideoSecondsForModel("15", "旧模型")).toBe("15");
    });

    it("只保留接口文档支持的六种画面比例", () => {
        expect(normalizeVideoSizeValue("16:9")).toBe("1280x720");
        expect(normalizeVideoSizeValue("9:16")).toBe("720x1280");
        expect(normalizeVideoSizeValue("4:3")).toBe("1024x768");
        expect(normalizeVideoSizeValue("3:4")).toBe("768x1024");
        expect(normalizeVideoSizeValue("1:1")).toBe("1024x1024");
        expect(normalizeVideoSizeValue("21:9")).toBe("1680x720");
        expect(normalizeVideoSizeValue("auto")).toBe("1280x720");
    });
});

