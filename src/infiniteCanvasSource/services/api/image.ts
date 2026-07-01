import axios from "axios";

import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { nanoid } from "nanoid";
import { imageToDataUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";
import { callImageApi } from "../../../lib/api";
import { normalizeSettings } from "../../../lib/apiProfiles";
import { buildApiUrl as buildDevApiUrl, readClientDevProxyConfig } from "../../../lib/devProxy";
import { sanitizeApiErrorMessage } from "../../../lib/imageApiShared";
import { useStore } from "../../../store";
import { DEFAULT_PARAMS, type AppSettings, type TaskParams } from "../../../types";

export type ChatCompletionMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** Map "quality + ratio" to an explicit pixel dimension like "3840x2160". Returns undefined when quality is auto. */
function resolveSize(quality: string, ratio: string): string | undefined {
    const basePixels = QUALITY_BASE[quality];
    if (!basePixels || ratio === "auto" || !ratio) return undefined;

    const parts = ratio.split(":");
    if (parts.length !== 2) return undefined;
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!w || !h) return undefined;

    const targetPixels = basePixels * basePixels;
    const isLandscape = w >= h;
    const longRatio = isLandscape ? w / h : h / w;

    const longSideRaw = Math.sqrt(targetPixels * longRatio);
    const longSide = Math.floor(longSideRaw / 16) * 16;
    const shortSide = Math.round((longSide / longRatio) / 16) * 16;

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;

    return `${width}x${height}`;
}

function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value === "auto") return undefined;
    if (/^\d+x\d+$/.test(value)) return value;
    return (quality && resolveSize(quality, value)) || value;
}

function resolveTaskQuality(config: AiConfig): TaskParams["quality"] {
    const quality = normalizeQuality(config.quality);
    return quality === "low" || quality === "medium" || quality === "high" ? quality : DEFAULT_PARAMS.quality;
}

function buildTaskParams(config: AiConfig): TaskParams {
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = resolveTaskQuality(config);
    return {
        ...DEFAULT_PARAMS,
        n,
        quality,
        // 品质可以交给模型自动判断，但比例仍要转成接口能识别的具体尺寸。
        size: resolveRequestSize(quality === "auto" ? "high" : quality, config.size) || DEFAULT_PARAMS.size,
    };
}

function buildCanvasImageSettings(config: AiConfig): AppSettings {
    const current = normalizeSettings(useStore.getState().settings);
    const model = config.imageModel || config.model || current.model;
    const activeProfile = current.profiles.find((profile) => profile.id === current.activeProfileId);
    const requestApiKey = activeProfile?.apiKey || config.apiKey || current.apiKey;
    const requestTimeout = config.timeout || activeProfile?.timeout || current.timeout;

    return normalizeSettings({
        ...current,
        apiKey: requestApiKey,
        model,
        timeout: requestTimeout,
        profiles: current.profiles.map((profile) =>
            profile.id === current.activeProfileId
                ? {
                      ...profile,
                      // 画布本地配置可能残留切站前的 key，生成时必须优先使用设置里当前站点的 key。
                      apiKey: profile.apiKey || config.apiKey,
                      model,
                      timeout: requestTimeout || profile.timeout,
                  }
                : profile,
        ),
    });
}

function toCanvasImages(images: string[]) {
    return images.map((dataUrl) => ({ id: nanoid(), dataUrl }));
}

function resolveImageDataUrl(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
    }
    if (typeof item.url === "string" && item.url) {
        return item.url;
    }
    return null;
}

function parseImagePayload(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(payload.msg || "请求失败");
    }
    const images =
        payload.data
            ?.map(resolveImageDataUrl)
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];

    if (images.length === 0) {
        throw new Error("接口没有返回图片");
    }

    return images;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data;
        return sanitizeApiErrorMessage(extractApiErrorMessage(responseData) || (error.response?.status ? `${fallback}：${error.response.status}` : fallback));
    }
    return sanitizeApiErrorMessage(error instanceof Error ? error.message : fallback);
}

function extractApiErrorMessage(payload: unknown): string {
    if (!payload) return "";
    if (typeof payload === "string") return payload.trim();
    if (Array.isArray(payload)) return payload.map(extractApiErrorMessage).filter(Boolean).join("\n");
    if (typeof payload !== "object") return "";

    const record = payload as Record<string, unknown>;
    const direct = stringValue(record.msg) || stringValue(record.message) || stringValue(record.error_message) || stringValue(record.detail);
    if (direct) return direct;
    if (typeof record.error === "string") return record.error.trim();
    return extractApiErrorMessage(record.error) || extractApiErrorMessage(record.data);
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseStreamChunk(chunk: string, onDelta: (value: string) => void) {
    let deltaText = "";
    for (const eventBlock of chunk.split("\n\n")) {
        const data = eventBlock
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
        if (!data || data === "[DONE]") continue;
        const delta = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content || "";
        deltaText += delta;
    }
    if (deltaText) onDelta(deltaText);
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function aiApiUrl(config: AiConfig, path: string, target: "image" | "textVideo" = "image") {
    const baseUrl = target === "textVideo" ? config.textBaseUrl.trim() : config.baseUrl;
    if (target !== "textVideo" && config.channelMode === "remote") return `/api/v1${path}`;

    const proxyConfig = readClientDevProxyConfig();
    return buildDevApiUrl(baseUrl, path, proxyConfig, false);
}

function aiHeaders(config: AiConfig, contentType?: string, target: "image" | "textVideo" = "image") {
    const token = useUserStore.getState().token;
    const apiKey = target === "textVideo" ? config.textApiKey.trim() : config.apiKey;
    return target !== "textVideo" && config.channelMode === "remote"
        ? {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(contentType ? { "Content-Type": contentType } : {}),
          }
        : {
              Authorization: `Bearer ${apiKey}`,
              ...(contentType ? { "Content-Type": contentType } : {}),
          };
}

function refreshRemoteUser(config: AiConfig) {
    if (config.channelMode === "remote") void useUserStore.getState().hydrateUser();
}

function requestTimeout(config: AiConfig, target: "image" | "textVideo" = "image") {
    const seconds = target === "textVideo" ? config.textTimeout : config.timeout;
    return Math.max(1, Number(seconds) || 120) * 1000;
}

function withSystemMessage(config: AiConfig, messages: ChatCompletionMessage[]) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

export async function requestGeneration(config: AiConfig, prompt: string) {
    try {
        const result = await callImageApi({
            settings: buildCanvasImageSettings(config),
            prompt: withSystemPrompt(config, prompt),
            params: buildTaskParams(config),
            inputImageDataUrls: [],
        });
        refreshRemoteUser(config);
        return toCanvasImages(result.images);
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[]) {
    try {
        const inputImageDataUrls = (
            await Promise.all(
                references.map(async (image) => {
                    const dataUrl = await imageToDataUrl(image);
                    return dataUrl;
                }),
            )
        ).filter((dataUrl): dataUrl is string => Boolean(dataUrl));
        const maskDataUrl = references.find((image) => image.isMaskTarget && image.maskDataUrl)?.maskDataUrl;
        const result = await callImageApi({
            settings: buildCanvasImageSettings(config),
            prompt: withSystemPrompt(config, prompt),
            params: buildTaskParams(config),
            inputImageDataUrls,
            maskDataUrl,
        });
        refreshRemoteUser(config);
        return toCanvasImages(result.images);
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestImageQuestion(config: AiConfig, messages: ChatCompletionMessage[], onDelta: (text: string) => void) {
    let buffer = "";
    let answer = "";
    let processedLength = 0;

    try {
        if (!config.textBaseUrl.trim() || !config.textApiKey.trim()) throw new Error("请先在设置里填写文字 API URL 和 Key");
        const response = await axios.post(
            aiApiUrl(config, "/chat/completions", "textVideo"),
            {
                model: config.textModel || config.model,
                messages: withSystemMessage(config, messages),
                stream: true,
            },
            {
                headers: {
                    ...aiHeaders(config, "application/json", "textVideo"),
                } as Record<string, string>,
                timeout: requestTimeout(config, "textVideo"),
                responseType: "text",
                onDownloadProgress: (event) => {
                    const responseText = String(event.event?.target?.responseText || "");
                    const nextText = responseText.slice(processedLength);
                    processedLength = responseText.length;
                    buffer += nextText;
                    const chunks = buffer.split("\n\n");
                    buffer = chunks.pop() || "";
                    for (const chunk of chunks) {
                        parseStreamChunk(chunk, (delta) => {
                            answer += delta;
                            onDelta(answer);
                        });
                    }
                },
            },
        );
        if (typeof response.data === "object" && response.data && "code" in response.data && (response.data as { code?: number; msg?: string }).code !== 0) {
            throw new Error((response.data as { msg?: string }).msg || "请求失败");
        }
        if (typeof response.data === "string") {
            let apiError = "";
            try {
                const payload = JSON.parse(response.data) as { code?: number; msg?: string };
                if (typeof payload.code === "number" && payload.code !== 0) {
                    apiError = payload.msg || "请求失败";
                }
            } catch {
                // ignore plain text stream content
            }
            if (apiError) throw new Error(apiError);
        }
        if (buffer) {
            parseStreamChunk(buffer, (delta) => {
                answer += delta;
                onDelta(answer);
            });
        }
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
    refreshRemoteUser(config);
    return answer || "没有返回内容";
}

export async function fetchImageModels(config: AiConfig) {
    if (config.channelMode === "remote") return config.models;
    try {
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(buildApiUrl(config.baseUrl, "/models"), {
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
        });
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}
