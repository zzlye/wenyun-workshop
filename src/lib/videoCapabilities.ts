import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxyForBaseUrl } from "./devProxy";
import { CANVAS_VIDEO_BASE_URL } from "./videoModel";

export type VideoMode = "auto" | "text" | "references" | "frames";
export interface VideoParameterDefinition {
    key: string;
    label: string;
    type: "string" | "integer" | "number" | "boolean";
    editable: boolean;
    required?: boolean;
    default?: unknown;
    options?: unknown[];
    min?: number;
    max?: number;
}
export interface VideoCapability {
    combinations?: {
        duration: { min?: number; max?: number; values?: number[] };
        resolutions?: string[];
        aspect_ratios?: string[];
        modes?: string[];
    }[];
    duration: { min?: number; max?: number; values?: number[]; default?: number };
    resolutions?: string[];
    aspect_ratios?: string[];
    modes?: string[];
    prompt_optional_with_image?: boolean;
    image_limit?: number;
    video_limit?: number;
    audio_limit?: number;
    audio_requires_visual?: boolean;
    video_requires_image?: boolean;
    first_frame_with_video?: boolean;
    generate_audio?: boolean;
    media_transport?: string;
    parameters?: VideoParameterDefinition[];
}
export interface VideoCapabilityResponse {
    model: string;
    version: number;
    configured: boolean;
    variants: VideoCapability[];
}

// 只合并展示用的同类型选项；真正校验仍逐个使用完整渠道能力，不拼接生成条件。
export function mergeVideoParameterDefinitions(variants: VideoCapability[]) {
    const groups = new Map<string, { key: string; definitions: VideoParameterDefinition[] }>();
    for (const p of variants.flatMap((v) => v.parameters ?? []).filter((p) => p.editable)) {
        let group = groups.get(p.key);
        if (!group) {
            group = { key: p.key, definitions: [] };
            groups.set(p.key, group);
        }
        const existing = group.definitions.find((d) => d.type === p.type);
        if (!existing) {
            group.definitions.push({ ...p, options: p.options ? [...p.options] : undefined });
            continue;
        }
        existing.options =
            existing.options?.length && p.options?.length ? Array.from(new Set([...existing.options, ...p.options])) : undefined;
        existing.min = existing.min !== undefined && p.min !== undefined ? Math.min(existing.min, p.min) : undefined;
        existing.max = existing.max !== undefined && p.max !== undefined ? Math.max(existing.max, p.max) : undefined;
        if (existing.default !== p.default) existing.default = undefined;
        existing.required = existing.required && p.required;
    }
    return Array.from(groups.values());
}

// 能力与生成共用视频密钥和代理。旧服务缺少能力接口时继续保持原有调用方式。
export async function fetchVideoCapabilities(
    apiKey: string,
    proxy: boolean,
    model: string,
    signal?: AbortSignal,
): Promise<VideoCapabilityResponse> {
    const config = readClientDevProxyConfig();
    const useProxy = shouldUseApiProxyForBaseUrl(proxy, CANVAS_VIDEO_BASE_URL, config);
    const response = await fetch(
        buildApiUrl(CANVAS_VIDEO_BASE_URL, `/video/capabilities?model=${encodeURIComponent(model)}`, config, useProxy),
        {
            headers: { Authorization: `Bearer ${apiKey.trim()}` },
            signal,
            cache: "no-store",
        },
    );
    if (response.status === 404) return { model, version: 0, configured: false, variants: [] };
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message || `获取模型能力失败：${response.status}`);
    if (!body || !Array.isArray(body.variants)) throw new Error("模型能力返回格式有误");
    return body as VideoCapabilityResponse;
}

export interface VideoSelection {
    duration?: number;
    resolution?: string;
    aspect_ratio?: string;
    mode?: VideoMode;
    prompt?: string;
    imageCount?: number;
    videoCount?: number;
    audioCount?: number;
    generate_audio?: boolean;
    extra_parameters?: Record<string, unknown>;
}

// 每次用一个完整能力对象校验，避免把不同渠道的秒数与清晰度拼成无效组合。
export function videoCapabilityError(cap: VideoCapability, input: VideoSelection): string | null {
    let mode = input.mode;
    if (mode === "auto") mode = (input.imageCount ?? 0) + (input.videoCount ?? 0) + (input.audioCount ?? 0) > 0 ? "references" : "text";
    if (
        cap.combinations?.length &&
        !cap.combinations.some(
            (combo) =>
                videoCapabilityError(
                    { ...combo },
                    { duration: input.duration, resolution: input.resolution, aspect_ratio: input.aspect_ratio, mode },
                ) === null,
        )
    )
        return "当前渠道不支持此参数组合";
    const d = input.duration;
    if (
        d !== undefined &&
        (!Number.isInteger(d) ||
            d < 1 ||
            d > 3600 ||
            (cap.duration.min !== undefined && d < cap.duration.min) ||
            (cap.duration.max !== undefined && d > cap.duration.max) ||
            (cap.duration.values?.length && !cap.duration.values.includes(d)))
    )
        return "当前模型不支持所选时长";
    if (input.resolution && cap.resolutions?.length && !cap.resolutions.includes(input.resolution)) return "当前模型不支持所选清晰度";
    if (input.aspect_ratio && cap.aspect_ratios?.length && !cap.aspect_ratios.includes(input.aspect_ratio)) return "当前模型不支持所选比例";
    if (mode && cap.modes?.length && !cap.modes.includes(mode)) return "当前模型不支持此生成模式";
    const images = input.imageCount ?? 0,
        videos = input.videoCount ?? 0,
        audios = input.audioCount ?? 0;
    if (mode === "text" && images + videos + audios > 0) return "文生视频模式与已连接的素材冲突，请选择多参考素材或首尾帧";
    if (mode === "frames") {
        if (input.imageCount !== undefined && (images < 1 || images > 2)) return "首尾帧模式需要一张或两张图片";
        if (audios || (videos && (!cap.first_frame_with_video || images > 1))) return "当前模型不支持首尾帧与这些参考素材混用";
    } else if (cap.image_limit !== undefined && images > cap.image_limit) return `参考图片最多 ${cap.image_limit} 张`;
    if (cap.video_limit !== undefined && videos > cap.video_limit) return `参考视频最多 ${cap.video_limit} 个`;
    if (cap.audio_limit !== undefined && audios > cap.audio_limit) return `参考音频最多 ${cap.audio_limit} 个`;
    if (cap.audio_requires_visual && audios > 0 && (mode === "frames" ? 0 : images) + videos === 0)
        return "参考音频需要同时提供参考图片或视频";
    if (cap.video_requires_image && videos > 0 && images === 0) return "参考视频需要同时提供图片";
    if (input.prompt !== undefined && !input.prompt.trim() && !(cap.prompt_optional_with_image && images > 0)) return "请输入视频提示词";
    if (input.generate_audio !== undefined && cap.generate_audio !== true) return "当前模型未声明生成音频控制能力";
    const parameters = cap.parameters ?? [];
    for (const [key, value] of Object.entries(input.extra_parameters ?? {})) {
        const definition = parameters.find((p) => p.key === key && p.editable);
        if (!definition) return `当前模型不支持参数 ${key}`;
        const error = validateVideoParameter(definition, value);
        if (error) return error;
    }
    // 仅完整提交时检查必填，选项联动时允许表单暂时不完整。
    if (input.prompt !== undefined)
        for (const p of parameters)
            if (p.required && input.extra_parameters?.[p.key] === undefined && p.default === undefined) return `请填写${p.label || p.key}`;
    return null;
}

export function validateVideoParameter(p: VideoParameterDefinition, value: unknown): string | null {
    const type = p.type === "integer" ? "number" : p.type;
    if (typeof value !== type || (p.type === "integer" && !Number.isInteger(value))) return `${p.label || p.key}的类型有误`;
    if (
        typeof value === "number" &&
        (!Number.isFinite(value) || (p.min !== undefined && value < p.min) || (p.max !== undefined && value > p.max))
    )
        return `${p.label || p.key}超出允许范围`;
    if (p.options?.length && !p.options.includes(value)) return `${p.label || p.key}不在可选值中`;
    return null;
}

export function videoSelectionError(capabilities: VideoCapabilityResponse, input: VideoSelection): string | null {
    if (!capabilities.configured || !capabilities.variants.length) return null;
    const errors = capabilities.variants.map((c) => videoCapabilityError(c, input));
    return errors.includes(null) ? null : Array.from(new Set(errors)).join("；");
}
