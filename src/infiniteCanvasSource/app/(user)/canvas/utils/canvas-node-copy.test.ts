import { describe, expect, it } from "vitest";

import { cloneNodeMetadataForDuplicate } from "./canvas-node-copy";
import type { CanvasNodeMetadata } from "../types";

describe("canvas node copy metadata", () => {
    it("resets loading state when a generating node is copied", () => {
        const metadata: CanvasNodeMetadata = {
            status: "loading",
            content: "old image",
            prompt: "生成一张图片",
            generationStartedAt: 123,
            generationElapsedMs: 456,
        };

        const result = cloneNodeMetadataForDuplicate(metadata);

        expect(result?.status).toBe("idle");
        expect(result?.generationStartedAt).toBeUndefined();
        expect(result?.generationElapsedMs).toBeUndefined();
        expect(result?.content).toBe("old image");
        expect(result?.prompt).toBe("生成一张图片");
    });

    it("clears temporary error and batch relation fields", () => {
        const result = cloneNodeMetadataForDuplicate({
            status: "error",
            errorDetails: "失败原因",
            references: ["text-1"],
            inputOrder: ["text-1"],
            isBatchRoot: true,
            batchRootId: "image-1",
            batchChildIds: ["image-2"],
            batchUsesReferenceImages: true,
            primaryImageId: "image-1",
            imageBatchExpanded: true,
        });

        expect(result).toMatchObject({ status: "error" });
        expect(result?.errorDetails).toBeUndefined();
        expect(result?.references).toBeUndefined();
        expect(result?.inputOrder).toBeUndefined();
        expect(result?.isBatchRoot).toBeUndefined();
        expect(result?.batchRootId).toBeUndefined();
        expect(result?.batchChildIds).toBeUndefined();
        expect(result?.batchUsesReferenceImages).toBeUndefined();
        expect(result?.primaryImageId).toBeUndefined();
        expect(result?.imageBatchExpanded).toBeUndefined();
    });

    it("keeps reusable generation settings and reference images", () => {
        const result = cloneNodeMetadataForDuplicate({
            status: "success",
            model: "gpt-image-2-4k",
            size: "1024x1024",
            quality: "high",
            count: 1,
            referenceImages: [{ id: "ref-1", name: "参考图", type: "image/png", dataUrl: "data:image/png;base64,abc" }],
            generationPrompt: "生成提示词",
            naturalWidth: 1024,
            naturalHeight: 1024,
        });

        expect(result).toMatchObject({
            status: "success",
            model: "gpt-image-2-4k",
            size: "1024x1024",
            quality: "high",
            count: 1,
            generationPrompt: "生成提示词",
            naturalWidth: 1024,
            naturalHeight: 1024,
        });
        expect(result?.referenceImages).toHaveLength(1);
    });
});
