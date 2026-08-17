// 画布视频统一经过站点自己的 NewAPI，避免浏览器绕过计费和渠道配置直连上游。
export const CANVAS_VIDEO_BASE_URL = "https://api.zzlye.xyz/v1";
export const CANVAS_VIDEO_TIMEOUT = 900;

// 红框中的两个 sd-2.0-933 模型不加入画布，其余文档模型保持可选。
export const CANVAS_VIDEO_MODELS = [
    "seedance-2.0-mini-431-720p",
    "seedance-2.0-mini-431-480p",
    "seedance-2.0-1080p",
    "seedance-2.0-720p",
    "seedance-2.0-fast-720p",
    "sd-2.5-720p",
    "seedance-2.5-720p",
    "seedance-2.5-480p",
    "kling-3.0-omni-720p",
    "kling-3.0-omni-1080p",
] as const;

export type CanvasVideoModel = (typeof CANVAS_VIDEO_MODELS)[number];

export const CANVAS_VIDEO_MODEL: CanvasVideoModel = "seedance-2.0-720p";
export const CANVAS_VIDEO_SECONDS = ["4", "5", "6", "8", "10", "15"] as const;
export const CANVAS_VIDEO_25_SECONDS = ["4", "5", "6", "8", "10", "15", "20", "25", "29"] as const;
export const CANVAS_VIDEO_KLING_SECONDS = ["5", "10", "15"] as const;
export const CANVAS_VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"] as const;

export function isCanvasVideoModel(value: string): value is CanvasVideoModel {
    return (CANVAS_VIDEO_MODELS as readonly string[]).includes(value);
}

export function normalizeCanvasVideoModel(value: string | undefined | null): CanvasVideoModel {
    const normalized = (value || "").trim();
    return isCanvasVideoModel(normalized) ? normalized : CANVAS_VIDEO_MODEL;
}

export function isCanvasVideo25Model(model: string) {
    return model.startsWith("seedance-2.5-") || model.startsWith("sd-2.5-");
}

export function isCanvasVideoKlingModel(model: string) {
    return model.startsWith("kling-3.0-omni-");
}

export function normalizeCanvasVideoKlingSeconds(value: string | number | undefined | null) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 10;
    return [5, 10, 15].reduce((closest, option) => Math.abs(option - numeric) < Math.abs(closest - numeric) ? option : closest, 10);
}

export function getCanvasVideoResolution(model: string) {
    if (model.includes("1080p")) return "1080";
    if (model.includes("480p")) return "480";
    return "720";
}
