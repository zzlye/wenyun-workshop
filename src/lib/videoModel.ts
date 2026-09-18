// 画布视频统一经过站点自己的 NewAPI，避免浏览器绕过计费和渠道配置直连上游。
export const CANVAS_VIDEO_BASE_URL = "https://api.zzlye.xyz/v1";
export const CANVAS_VIDEO_TIMEOUT = 900;

// 默认值只用于空配置，不作为 API 模型列表的白名单。
export const CANVAS_VIDEO_MODEL = "seedance-2.0-720p";
export const CANVAS_VIDEO_SECONDS = ["4", "5", "6", "8", "10", "15"] as const;
export const CANVAS_VIDEO_25_SECONDS = ["4", "5", "6", "8", "10", "15", "20", "25", "29"] as const;
export const CANVAS_VIDEO_KLING_SECONDS = ["5", "10", "15"] as const;
export const CANVAS_VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"] as const;

export function normalizeCanvasVideoModel(value: string | undefined | null): string {
    const normalized = (value || "").trim();
    // API 新增模型及历史节点中的模型名必须原样保留，避免提交时悄悄换成默认模型。
    return normalized || CANVAS_VIDEO_MODEL;
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
