// 画布视频统一经过站点自己的 NewAPI，避免浏览器绕过计费和渠道配置直连上游。
export const CANVAS_VIDEO_BASE_URL = "https://api.zzlye.xyz/v1";
export const CANVAS_VIDEO_TIMEOUT = 900;

// 默认值只用于空配置，不作为 API 模型列表的白名单。
export const CANVAS_VIDEO_MODEL = "seedance-2.0-720p";
// 所有模型共用中转协议参数，不再从模型名称推断或限制能力。
export const CANVAS_VIDEO_MIN_SECONDS = 1;
export const CANVAS_VIDEO_MAX_SECONDS = 30;
export const CANVAS_VIDEO_SECONDS = ["5", "10", "15", "20", "25", "30"] as const;
export const CANVAS_VIDEO_RESOLUTIONS = ["480", "720", "1080"] as const;
export const CANVAS_VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"] as const;

export function normalizeCanvasVideoModel(value: string | undefined | null): string {
    const normalized = (value || "").trim();
    // API 新增模型及历史节点中的模型名必须原样保留，避免提交时悄悄换成默认模型。
    return normalized || CANVAS_VIDEO_MODEL;
}

export function normalizeCanvasVideoDuration(value: string) {
    if (!value?.trim() || !Number.isFinite(Number(value))) return 10;
    return Math.min(CANVAS_VIDEO_MAX_SECONDS, Math.max(CANVAS_VIDEO_MIN_SECONDS, Math.round(Number(value))));
}

export function normalizeCanvasVideoAspectRatio(value: string) {
    const trimmed = (value || "").trim();
    let ratio = trimmed;
    // 历史画布以宽高像素保存比例，提交和设置面板共用同一转换，防止显示与请求不一致。
    if (/^\d+x\d+$/.test(trimmed)) {
        const [width, height] = trimmed.split("x").map(Number);
        const numeric = width / height;
        ratio = !width || !height ? "16:9" : Math.abs(width - height) / Math.max(width, height) < 0.02 ? "1:1"
            : numeric >= 2 ? "21:9" : numeric >= 1.5 ? "16:9" : numeric >= 1.15 ? "4:3"
                : numeric <= 0.65 ? "9:16" : numeric <= 0.85 ? "3:4" : "16:9";
    }
    return CANVAS_VIDEO_ASPECT_RATIOS.find((option) => option === ratio) || "16:9";
}

export function normalizeCanvasVideoResolution(value: string) {
    const normalized = (value || "").trim().replace(/p$/i, "");
    return CANVAS_VIDEO_RESOLUTIONS.find((option) => option === normalized) || "720";
}
