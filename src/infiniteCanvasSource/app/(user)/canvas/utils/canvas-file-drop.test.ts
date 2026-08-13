import { describe, expect, it } from "vitest";

import { layoutDroppedCanvasNodes } from "./canvas-file-drop";

describe("layoutDroppedCanvasNodes", () => {
    it("将多张图片围绕拖入点排列且互不重叠", () => {
        const sizes = [
            { width: 640, height: 360 },
            { width: 320, height: 640 },
            { width: 480, height: 480 },
            { width: 640, height: 640 },
        ];
        const positions = layoutDroppedCanvasNodes({ x: 1000, y: 800 }, sizes);

        expect(positions).toHaveLength(sizes.length);
        positions.forEach((position, index) => {
            expect(Number.isFinite(position.x)).toBe(true);
            expect(Number.isFinite(position.y)).toBe(true);
            for (let otherIndex = index + 1; otherIndex < positions.length; otherIndex += 1) {
                const other = positions[otherIndex];
                const separated =
                    position.x + sizes[index].width <= other.x ||
                    other.x + sizes[otherIndex].width <= position.x ||
                    position.y + sizes[index].height <= other.y ||
                    other.y + sizes[otherIndex].height <= position.y;
                expect(separated).toBe(true);
            }
        });
    });

    it("单张图片仍以拖入点为中心", () => {
        expect(layoutDroppedCanvasNodes(
            { x: 500, y: 300 },
            [{ width: 200, height: 100 }],
        )).toEqual([{ x: 400, y: 250 }]);
    });
});
