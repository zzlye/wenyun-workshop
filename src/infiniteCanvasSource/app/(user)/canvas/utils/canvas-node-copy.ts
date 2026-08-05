import type { CanvasNodeMetadata } from "../types";

export function cloneNodeMetadataForDuplicate(metadata?: CanvasNodeMetadata) {
    if (!metadata) return undefined;
    const nextStatus = metadata.status === "loading" ? "idle" : metadata.status;
    // 复制节点只保留可复用内容，生成中的临时状态和批次关系必须断开。
    return {
        ...metadata,
        status: nextStatus,
        errorDetails: undefined,
        generationStartedAt: undefined,
        generationElapsedMs: undefined,
        imageTaskId: undefined,
        imageTaskAccessToken: undefined,
        imageTaskIdempotencyKey: undefined,
        imageTaskRequestFingerprint: undefined,
        imageTaskApiProfileId: undefined,
        references: undefined,
        inputOrder: undefined,
        isBatchRoot: undefined,
        batchRootId: undefined,
        batchChildIds: undefined,
        batchUsesReferenceImages: undefined,
        primaryImageId: undefined,
        imageBatchExpanded: undefined,
    };
}
