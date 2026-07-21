import { describe, expect, it } from "vitest";

import { getSoraV3FixedResolution, isSoraV3VideoModel } from "./video-model-capabilities";

describe("video model capabilities", () => {
    it.each([
        ["seedream2.0-fast-720p", "720p"],
        ["seedream2.0-720p", "720p"],
        ["seedream2.0-1080p", "1080p"],
        ["sora-v3-pro-1080p", "1080p"],
    ])("recognizes %s as Sora V3 with fixed %s resolution", (model, resolution) => {
        expect(isSoraV3VideoModel(model)).toBe(true);
        expect(getSoraV3FixedResolution(model)).toBe(resolution);
    });
});
