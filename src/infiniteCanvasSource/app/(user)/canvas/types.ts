export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    // 仅供旧存档迁移识别，不再创建或渲染独立的生成配置卡片。
    Config = "config",
    Video = "video",
    Audio = "audio",
}

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
    maskDataUrl?: string;
    maskStorageKey?: string;
    isMaskTarget?: boolean;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
};

export type CanvasNodeMetadata = {
    content?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    // 保留旧生成来源的重试查找能力，节点本身已经迁移成普通媒体或文本节点。
    legacyGenerationSource?: boolean;
    generationType?: CanvasImageGenerationType;
    model?: string;
    size?: string;
    quality?: string;
    imageBackground?: string;
    count?: number;
    seconds?: string;
    videoGenerateAudio?: boolean | null;
    videoMode?: "auto" | "text" | "references" | "frames";
    videoExtraParameters?: Record<string, unknown>;
    vquality?: string;
    references?: string[];
    referenceImages?: CanvasReferenceImage[];
    generationStartedAt?: number;
    generationElapsedMs?: number;
    generationPrompt?: string;
    imageTaskId?: string;
    imageTaskAccessToken?: string;
    imageTaskIdempotencyKey?: string;
    imageTaskRequestFingerprint?: string;
    imageTaskApiProfileId?: string;
    // 视频异步任务 ID，用于页面刷新后继续轮询原任务，避免重复提交生成请求。
    videoTaskId?: string;
    // 已生成的视频单独显示下载和保存状态，避免继续误报生成中。
    videoTaskPhase?: "downloading" | "saving";
    naturalWidth?: number;
    naturalHeight?: number;
    manualSize?: boolean;
    manualTitle?: boolean;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    inputOrder?: string[];
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    duration?: number;
    assetCategory?: string;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeType;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasGroupLayout = "free" | "grid" | "horizontal" | "vertical";

export type CanvasGroupData = {
    id: string;
    title: string;
    nodeIds: string[];
    color: string;
    layout: CanvasGroupLayout;
    padding: number;
};

export type ConnectionSide = "left" | "right";

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    // 数据流向与物理连接侧分开保存，避免反向拖线后端点翻到背面。
    fromSide?: ConnectionSide;
    toSide?: ConnectionSide;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeType;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant";
    mode: "ask" | "image";
    text: string;
    isLoading?: boolean;
    references?: CanvasAssistantReference[];
    images?: CanvasAssistantImage[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
    // 拖线开始时保存多选起点，后续悬停或新建目标不改变本次连接范围。
    nodeIds?: string[];
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          position: Position;
          nodeId: string;
      }
    | {
          type: "canvas";
          x: number;
          y: number;
          position: Position;
      };
