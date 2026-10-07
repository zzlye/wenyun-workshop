// 画布视频统一经过站点自己的 NewAPI，避免浏览器绕过计费和渠道配置直连上游。
export const CANVAS_VIDEO_BASE_URL = "https://api.zzlye.xyz/v1";
// 设置显示、历史配置归一化和视频请求共用秒数，避免只修改界面而实际提前超时。
export const CANVAS_VIDEO_TIMEOUT = 1800;

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

// 保留用户输入，由模型能力校验解释错误，避免默默缩短视频。
export function normalizeCanvasVideoDuration(value: string) {
    return value?.trim() ? Number(value) : 10;
}

export function normalizeCanvasVideoAspectRatio(value: string) {
    const trimmed = (value || "").trim();
    let ratio = trimmed;
    // 历史画布以宽高像素保存比例，提交和设置面板共用同一转换，防止显示与请求不一致。
    if (/^\d+x\d+$/.test(trimmed)) {
        const [width, height] = trimmed.split("x").map(Number);
        const known: Record<string,string> = {"1280x720":"16:9","720x1280":"9:16","1024x768":"4:3","768x1024":"3:4","1024x1024":"1:1","1680x720":"21:9"};
        let a = width, b = height;
        while (b) { [a,b] = [b,a % b]; }
        ratio = !width || !height ? "16:9" : known[trimmed] || `${width / a}:${height / a}`;
    }
    return !ratio || ratio === "auto" ? "16:9" : ratio;
}

export function normalizeCanvasVideoResolution(value: string) {
    const normalized = (value || "").trim().toLowerCase().replace(/p$/, "");
    return normalized === "2160" ? "4k" : normalized || "720";
}
