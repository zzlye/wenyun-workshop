import { describe, expect, it } from "vitest";

import { clearCanvasGenerationSession, getCanvasGenerationSessionIds, isCanvasNodeGenerationLocked, markCanvasGenerationSession, resetInterruptedCanvasGenerations } from "./canvas-generation-running";
import { CanvasNodeType, type CanvasNodeData } from "../types";

function node(id: string, status: "loading" | "success" | "error"): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: { status },
    };
}

describe("canvas generation running session", () => {
    it("keeps loading nodes locked but releases stale running ids after completion", () => {
        expect(isCanvasNodeGenerationLocked(node("image-1", "loading"), new Set())).toBe(true);
        expect(isCanvasNodeGenerationLocked(node("image-1", "success"), new Set(["image-1"]))).toBe(false);
        expect(isCanvasNodeGenerationLocked(node("image-1", "error"), new Set(["image-1"]))).toBe(false);
    });

    it("keeps loading nodes when the same browser session still owns the generation", () => {
        markCanvasGenerationSession("project-1", "image-1");

        const result = resetInterruptedCanvasGenerations([node("image-1", "loading")], getCanvasGenerationSessionIds("project-1"));

        expect(result[0].metadata?.status).toBe("loading");
        clearCanvasGenerationSession("project-1", ["image-1"]);
    });

    it("keeps recoverable image tasks loading after a real page refresh", () => {
        const recoverable = node("image-1", "loading");
        recoverable.metadata = {
            ...recoverable.metadata,
            imageTaskIdempotencyKey: "canvas-task-key",
        };

        const result = resetInterruptedCanvasGenerations([recoverable], new Set());

        expect(result[0].metadata?.status).toBe("loading");
        expect(result[0].metadata?.errorDetails).toBeUndefined();
    });

    it("marks stale loading nodes as retryable after session state is gone", () => {
        const result = resetInterruptedCanvasGenerations([node("image-1", "loading")], getCanvasGenerationSessionIds("project-2"));

        expect(result[0].metadata).toMatchObject({
            status: "error",
            errorDetails: "页面刷新后前端连接已断开，后台可能已提交请求，无法自动取回本次结果。请确认结果或余额后再重试。",
        });
    });
});
