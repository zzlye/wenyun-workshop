// @ts-nocheck
import axios from "axios";

import { getDataUrlByteSize } from "@/lib/image-utils";
import { mediaToDataUrl } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceAudio, ReferenceImage, ReferenceVideo } from "@/types/image";
import { buildApiUrl as buildDevApiUrl, getLockedAssetProxyUrl, readClientDevProxyConfig, shouldUseApiProxyForBaseUrl } from "../../../lib/devProxy";
import { sanitizeApiErrorMessage } from "../../../lib/imageApiShared";
import {
    CANVAS_VIDEO_BASE_URL,
    CANVAS_VIDEO_TIMEOUT,
    normalizeCanvasVideoAspectRatio,
    normalizeCanvasVideoDuration,
    normalizeCanvasVideoResolution,
    normalizeCanvasVideoModel,
} from "../../../lib/videoModel";

type VideoTask = {
    id: string;
    status?: string;
    url?: string;
    videoUrl?: string;
    output?: unknown;
    error?: { message?: string };
};

type VideoApiResponse = VideoTask | {
    code?: number;
    data?: unknown;
    msg?: string;
    error?: { message?: string };
};

type VideoApiSource = {
    baseUrl: string;
    apiKey: string;
    apiProxy: boolean;
    timeout: number;
};

export type VideoTaskReference = {
    taskId: string;
};

const VIDEO_POLL_INTERVAL_MS = typeof process !== "undefined" && process.env.NODE_ENV === "test" ? 1 : 5000;
const VIDEO_TOTAL_TIMEOUT_MS = CANVAS_VIDEO_TIMEOUT * 1000;
const VIDEO_REFERENCE_MAX_EDGE = 1920;
const VIDEO_REFERENCE_MAX_INLINE_BYTES = 8 * 1024 * 1024;
const VIDEO_REFERENCE_JPEG_QUALITY = 0.88;

/**
 * 画布视频节点只调用固定地址的异步视频接口。
 * 创建、查询和下载都保持在同一套 /v1/videos 路径，避免旧模型兼容分支误发请求。
 */
export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], audioReferences: ReferenceAudio[] = [], videoReferences: ReferenceVideo[] = [], taskReference?: VideoTaskReference, onTaskCreated?: (task: VideoTaskReference) => void) {
    const source = resolveVideoApiSource(config);
    const payload = await buildCanvasVideoPayload(config, prompt, references, audioReferences, videoReferences);

    try {
        const created = taskReference?.taskId ? { id: taskReference.taskId, status: "processing" } : unwrapVideoTask(await createVideoTask(source, payload));
        if (!taskReference?.taskId && created.id) onTaskCreated?.({ taskId: created.id });
        const result = await waitForVideoResult(source, created);
        refreshRemoteUser(config);
        return result;
    } catch (error) {
        throw new Error(readAxiosError(error, "视频生成失败"));
    }
}

async function createVideoTask(source: VideoApiSource, payload: Record<string, unknown>) {
    const post = async (body: Record<string, unknown>) => (await axios.post<VideoApiResponse>(videoApiUrl(source, "/videos"), body, {
        headers: { ...videoApiHeaders(source), "Content-Type": "application/json" },
        timeout: requestTimeout(source),
    })).data;
    try {
        return await post(payload);
    } catch (error) {
        // 部分视频中转仍使用 input_reference 对象接收首张图片；仅在明确的参数校验错误时切换格式，避免任务已创建后重复扣费。
        if (isInputReferenceObjectError(error)) {
            const imageUrls = Array.isArray(payload.image_urls) ? payload.image_urls.filter((url): url is string => typeof url === "string" && Boolean(url)) : [];
            if (imageUrls.length) {
                const objectReferencePayload = { ...payload, input_reference: { image_url: imageUrls[0] } };
                delete objectReferencePayload.image_urls;
                try {
                    return await post(objectReferencePayload);
                } catch (objectReferenceError) {
                    // 另一类中转把同名字段声明成字符串；兼容该协议时仍只在参数校验失败后再次尝试。
                    if (!isInputReferenceStringError(objectReferenceError)) throw objectReferenceError;
                    const stringReferencePayload = { ...payload, input_reference: imageUrls[0] };
                    delete stringReferencePayload.image_urls;
                    return post(stringReferencePayload);
                }
            }
        }
        const currentField = "seconds" in payload ? "seconds" : "duration";
        const alternateField = currentField === "seconds" ? "duration" : "seconds";
        // 只有明确拒绝创建任务的缺字段错误才转换一次，超时或服务端异常不重发付费请求。
        if (!axios.isAxiosError(error) || ![400, 422].includes(error.response?.status)
            || hasVideoTaskId(error.response?.data) || !isMissingDurationField(error.response?.data, alternateField)) throw error;
        const converted = { ...payload, [alternateField]: payload[currentField] };
        delete converted[currentField];
        return post(converted);
    }
}

function isInputReferenceObjectError(error: unknown) {
    if (!axios.isAxiosError(error) || ![400, 422].includes(error.response?.status)) return false;
    if (hasVideoTaskId(error.response?.data)) return false;
    const message = extractApiErrorMessage(error.response?.data);
    return /input_reference/i.test(message) && /image_url/i.test(message) && /object/i.test(message);
}

function isInputReferenceStringError(error: unknown) {
    if (!axios.isAxiosError(error) || ![400, 422].includes(error.response?.status)) return false;
    if (hasVideoTaskId(error.response?.data)) return false;
    const message = extractApiErrorMessage(error.response?.data);
    return /input_reference/i.test(message) && /string/i.test(message) && /unmarshal|unmarshal|type/i.test(message);
}

function hasVideoTaskId(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return Boolean(record.id || record.task_id || record.taskId) || Object.values(record).some(hasVideoTaskId);
}

function isMissingDurationField(value: unknown, field: "seconds" | "duration") {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : record;
    if (error.param === field && ["missing_required_parameter", "field_required", "missing"].includes(String(error.code))) return true;
    // 兼容结构化校验响应，仅识别请求体顶层的时长字段，不误判参考素材自身的时长。
    if (Array.isArray(record.detail) && record.detail.some((item) => Array.isArray(item?.loc)
        && item.loc.length === 2 && item.loc[0] === "body" && item.loc[1] === field
        && ["missing", "value_error.missing"].includes(item.type))) return true;
    const message = extractApiErrorMessage(value);
    return new RegExp(`\\b${field}\\b[\\s'\"\x60:：]*(?:(?:field|parameter)\\s+)?(?:is\\s+)?(?:required|missing)\\b|\\b(?:missing|required)\\s+(?:(?:field|parameter)\\s*[:：]?\\s*)?['\"\x60]?${field}\\b|(?:缺少|缺失|必填)(?:参数|字段)?\\s*[:：]?\\s*['\"\x60]?${field}\\b|\\b${field}\\b[\\s'\"\x60:：]*(?:参数|字段)?(?:为必填|不能为空|是必填)`, "i").test(message);
}

async function buildCanvasVideoPayload(config: AiConfig, prompt: string, references: ReferenceImage[], audioReferences: ReferenceAudio[], videoReferences: ReferenceVideo[]) {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) throw new Error("请输入视频提示词");
    const model = normalizeCanvasVideoModel(config.videoModel || config.model);
    const payload: Record<string, unknown> = {
        model,
        prompt: normalizedPrompt,
        aspect_ratio: normalizeCanvasVideoAspectRatio(config.size),
        duration: normalizeCanvasVideoDuration(config.videoSeconds),
        resolution: `${normalizeCanvasVideoResolution(config.vquality)}p`,
        generate_audio: config.videoGenerateAudio ?? true,
    };

    // 参考素材只发送统一数组字段，供应商别名及首尾帧规则由中转适配。
    // 本地图片和音频沿用现有 data URL 传输，接收方若要求公网地址需在中转落存储。
    const videos = videoReferences.map(videoToReferenceUrl);
    const images = await Promise.all(references.map(imageToVideoReferenceUrl));
    const audios = await Promise.all(audioReferences.map(audioToVideoReferenceUrl));
    if (images.some((url) => !url) || audios.some((url) => !url)) throw new Error("参考媒体读取失败，请重新添加");
    if (images.length) payload.image_urls = images;
    if (audios.length) payload.audio_urls = audios;
    if (videos.length) payload.video_urls = videos;

    return payload;
}

async function waitForVideoResult(source: VideoApiSource, created: VideoTask) {
    if (!created.id) throw new Error("视频接口没有返回任务 ID");
    let task = created;
    const deadline = Date.now() + VIDEO_TOTAL_TIMEOUT_MS;

    for (;;) {
        const videoUrl = findVideoUrl(task);
        if (videoUrl) return fetchVideoResultBlob(source, created.id, videoUrl, remainingTimeout(deadline));
        if (isVideoStatusCompleted(task.status)) return fetchVideoContent(source, created.id, remainingTimeout(deadline));
        if (isVideoStatusFailed(task.status)) throw new Error(task.error?.message || "视频生成失败");

        const remaining = remainingTimeout(deadline);
        if (!remaining) throw new Error(`视频生成超过 ${CANVAS_VIDEO_TIMEOUT} 秒仍未完成`);
        await delayVideoPoll(Math.min(VIDEO_POLL_INTERVAL_MS, remaining));
        const nextRemaining = remainingTimeout(deadline);
        if (!nextRemaining) throw new Error(`视频生成超过 ${CANVAS_VIDEO_TIMEOUT} 秒仍未完成`);
        task = unwrapVideoTask((await axios.get<VideoApiResponse>(videoApiUrl(source, `/videos/${created.id}`), {
            headers: videoApiHeaders(source),
            timeout: requestTimeout(source, nextRemaining),
        })).data);
    }
}

async function fetchVideoContent(source: VideoApiSource, taskId: string, timeoutMs = requestTimeout(source)) {
    const contentPath = `/videos/${taskId}/content`;
    const primaryUrl = videoApiUrl(source, contentPath);
    try {
        return await requestVideoContent(primaryUrl, source, timeoutMs);
    } catch (primaryError) {
        // 主代理偶发 502 时改走同源 NewAPI 直连路径，保持浏览器不跨域且不改变扣费任务。
        const fallbackUrl = getLockedAssetProxyUrl(`${source.baseUrl.replace(/\/+$/, "")}${contentPath}`);
        if (!fallbackUrl || fallbackUrl === primaryUrl) throw primaryError;
        try {
            return await requestVideoContent(fallbackUrl, source, timeoutMs);
        } catch {
            throw primaryError;
        }
    }
}

async function requestVideoContent(url: string, source: VideoApiSource, timeoutMs: number) {
    const response = await axios.get<Blob>(url, {
        headers: videoApiHeaders(source),
        responseType: "blob",
        timeout: timeoutMs,
    });
    await assertVideoBlob(response.data);
    return response.data;
}

// 优先使用带鉴权的 content 下载端点，避免外部视频地址被浏览器跨域策略拦截。
async function fetchVideoResultBlob(source: VideoApiSource, taskId: string, videoUrl: string, timeoutMs = requestTimeout(source)) {
    try {
        return await fetchVideoContent(source, taskId, timeoutMs);
    } catch (error) {
        if (!shouldFallbackToDirectVideoUrl(error)) throw error;
    }

    const downloadUrl = getLockedAssetProxyUrl(videoUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(downloadUrl, {
            cache: "no-store",
            headers: shouldSendVideoDownloadAuth(source, videoUrl) ? videoApiHeaders(source) : undefined,
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`视频 URL 下载失败：HTTP ${response.status}`);
        const blob = await response.blob();
        await assertVideoBlob(blob);
        return blob;
    } catch (error) {
        if (controller.signal.aborted) throw new Error("视频结果下载超时");
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function resolveVideoApiSource(config: AiConfig): VideoApiSource {
    const apiKey = config.videoApiKey.trim();
    if (!apiKey) throw new Error("请先在设置里填写视频 API Key");
    return {
        baseUrl: CANVAS_VIDEO_BASE_URL,
        apiKey,
        apiProxy: Boolean(config.videoApiProxy),
        timeout: CANVAS_VIDEO_TIMEOUT,
    };
}

function videoApiUrl(source: VideoApiSource, path: string) {
    const proxyConfig = readClientDevProxyConfig();
    const useApiProxy = shouldUseApiProxyForBaseUrl(source.apiProxy, source.baseUrl, proxyConfig);
    return buildDevApiUrl(source.baseUrl, path, proxyConfig, useApiProxy);
}

function videoApiHeaders(source: VideoApiSource) {
    return { Authorization: `Bearer ${source.apiKey}` };
}

function requestTimeout(source: VideoApiSource, remainingMs = source.timeout * 1000) {
    return Math.max(1000, Math.min(source.timeout * 1000, remainingMs));
}

function refreshRemoteUser(config: AiConfig) {
    if (config.channelMode === "remote") void useUserStore.getState().hydrateUser();
}

async function imageToVideoReferenceUrl(image: ReferenceImage) {
    const directUrl = (image.url || "").trim();
    if (/^https?:\/\//i.test(directUrl)) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    return optimizeVideoReferenceDataUrl(dataUrl);
}

async function audioToVideoReferenceUrl(audio: ReferenceAudio) {
    const directUrl = (audio.url || "").trim();
    if (/^https?:\/\//i.test(directUrl)) return directUrl;

    const dataUrl = await mediaToDataUrl(audio);
    if (!dataUrl) return "";
    if (!dataUrl.startsWith("data:audio/")) throw new Error("参考音频格式不正确，请上传 MP3 或 WAV 音频");
    return normalizeVideoReferenceAudioDataUrl(dataUrl);
}

function videoToReferenceUrl(video: ReferenceVideo) {
    const directUrl = (video.url || "").trim();
    // 上游只接受公网 HTTP(S) 视频地址，浏览器的 blob 地址只用于本地预览，不能直接提交。
    try {
        const parsed = new URL(directUrl);
        if (["http:", "https:"].includes(parsed.protocol)) return parsed.href;
    } catch {
        // 无效地址与本地 blob 均在创建任务前报告，避免静默丢弃参考后扣费。
    }
    throw new Error("参考视频需要可访问的 HTTP(S) 地址，请先上传到可访问的存储");
}

async function normalizeVideoReferenceAudioDataUrl(dataUrl: string) {
    const audioContextType = typeof AudioContext !== "undefined" ? AudioContext : typeof webkitAudioContext !== "undefined" ? webkitAudioContext : null;
    if (!audioContextType) return dataUrl;

    const blob = await (await fetch(dataUrl)).blob();
    const context = new audioContextType();
    try {
        const buffer = await context.decodeAudioData(await blob.arrayBuffer());
        // 本地音频统一转换为 WAV，减少浏览器录音格式被上游拒绝的情况。
        return audioBufferToWavDataUrl(buffer);
    } finally {
        void context.close?.();
    }
}

function audioBufferToWavDataUrl(buffer: AudioBuffer) {
    const channelCount = Math.min(2, buffer.numberOfChannels || 1);
    const sampleRate = buffer.sampleRate;
    const frameCount = buffer.length;
    const dataSize = frameCount * channelCount * 2;
    const wav = new ArrayBuffer(44 + dataSize);
    const view = new DataView(wav);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channelCount * 2, true);
    view.setUint16(32, channelCount * 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);

    const channels = Array.from({ length: channelCount }, (_, index) => buffer.getChannelData(index));
    let offset = 44;
    for (let frame = 0; frame < frameCount; frame++) {
        for (let channel = 0; channel < channelCount; channel++) {
            const sample = Math.max(-1, Math.min(1, channels[channel][frame] || 0));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }
    return blobToDataUrl(new Blob([wav], { type: "audio/wav" }));
}

function writeAscii(view: DataView, offset: number, value: string) {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
}

async function optimizeVideoReferenceDataUrl(dataUrl: string) {
    if (!dataUrl.startsWith("data:image/") || typeof document === "undefined" || typeof Image === "undefined") return dataUrl;

    const image = await loadVideoReferenceImage(dataUrl);
    const maxEdge = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
    if (maxEdge <= VIDEO_REFERENCE_MAX_EDGE && getDataUrlByteSize(dataUrl) <= VIDEO_REFERENCE_MAX_INLINE_BYTES) return dataUrl;

    const scale = Math.min(1, VIDEO_REFERENCE_MAX_EDGE / Math.max(1, maxEdge));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    // 参考图只承担视觉引导，压缩到接口稳定接收的尺寸后再提交。
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToVideoReferenceBlob(canvas);
    return blobToDataUrl(blob);
}

function loadVideoReferenceImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("视频参考图读取失败，请重新上传或替换这张图片后重试"));
        image.src = dataUrl;
    });
}

function canvasToVideoReferenceBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) reject(new Error("视频参考图压缩失败"));
            else resolve(blob);
        }, "image/jpeg", VIDEO_REFERENCE_JPEG_QUALITY);
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("视频参考文件读取失败"));
        reader.readAsDataURL(blob);
    });
}

function unwrapVideoTask(payload: VideoApiResponse): VideoTask {
    if (!payload) throw new Error("接口没有返回视频任务");
    if (typeof payload === "object" && "code" in payload && typeof payload.code === "number" && ![0, 200].includes(payload.code)) {
        throw new Error(payload.msg || payload.error?.message || "请求失败");
    }
    const data = typeof payload === "object" && "data" in payload ? payload.data : payload;
    const task = findVideoTask(data);
    if (!task) throw new Error("接口没有返回视频任务");
    return task;
}

function findVideoTask(input: unknown): VideoTask | null {
    if (!input) return null;
    if (Array.isArray(input)) {
        for (const item of input) {
            const task = findVideoTask(item);
            if (task) return task;
        }
        return null;
    }
    if (typeof input !== "object") return null;

    const record = input as Record<string, unknown>;
    const id = stringValue(record.id) || stringValue(record.task_id) || stringValue(record.taskId);
    const status = stringValue(record.status) || stringValue(record.state);
    const url = readDirectVideoUrl(record);
    if (id || status || url) {
        const errorMessage = stringValue((record.error as Record<string, unknown> | undefined)?.message) || stringValue(record.error_message) || stringValue(record.fail_reason);
        return { id, status, url, videoUrl: stringValue(record.videoUrl), output: record.output, error: errorMessage ? { message: errorMessage } : undefined };
    }

    for (const value of Object.values(record)) {
        const task = findVideoTask(value);
        if (task) return task;
    }
    return null;
}

function findVideoUrl(input: unknown): string {
    if (!input) return "";
    if (typeof input === "string") {
        const parsed = parseJsonString(input);
        if (parsed) return findVideoUrl(parsed);
        const match = input.match(/https?:\/\/[^\s)"'<>]+?\.(?:mp4|webm|mov)(?:\?[^\s)"'<>]+)?/i);
        return match?.[0] || "";
    }
    if (Array.isArray(input)) {
        for (const item of input) {
            const url = findVideoUrl(item);
            if (url) return url;
        }
        return "";
    }
    if (typeof input !== "object") return "";

    const record = input as Record<string, unknown>;
    const direct = readDirectVideoUrl(record);
    if (direct) return direct;
    for (const value of Object.values(record)) {
        const url = findVideoUrl(value);
        if (url) return url;
    }
    return "";
}

function readDirectVideoUrl(record: Record<string, unknown>) {
    return stringValue(record.url) || stringValue(record.video_url) || stringValue(record.videoUrl) || stringValue(record.output_url) || stringValue(record.result_url) || stringValue(record.file_url) || directVideoUrl(record.output);
}

function directVideoUrl(value: unknown) {
    const text = stringValue(value);
    return /^(?:https?:\/\/|\/)/i.test(text) ? text : "";
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseJsonString(value: string) {
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
    try {
        return JSON.parse(trimmed) as unknown;
    } catch {
        return null;
    }
}

function isVideoStatusCompleted(status?: string) {
    return ["completed", "succeeded", "success", "done"].includes((status || "").toLowerCase());
}

function isVideoStatusFailed(status?: string) {
    return ["fail", "failed", "failure", "cancelled", "canceled", "error"].includes((status || "").toLowerCase());
}

function shouldFallbackToDirectVideoUrl(error: unknown) {
    // content 端点在不同 NewAPI 版本中可能返回 404、405 或 5xx；只要任务带有结果地址，就统一尝试同源代理回退。
    return Boolean(error);
}

function shouldSendVideoDownloadAuth(source: VideoApiSource, url: string) {
    if (url.startsWith("/api-proxy/") || url.startsWith("/v1/videos/")) return true;
    if (!/^https?:\/\//i.test(url)) return false;
    try {
        const target = new URL(url);
        const apiRoot = new URL(source.baseUrl.includes("/v1") ? source.baseUrl : `${source.baseUrl}/v1`);
        return target.origin === apiRoot.origin && target.pathname.startsWith(`${apiRoot.pathname.replace(/\/+$/, "")}/videos/`);
    } catch {
        return false;
    }
}

function delayVideoPoll(delayMs = VIDEO_POLL_INTERVAL_MS) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function remainingTimeout(deadline: number) {
    return Math.max(0, deadline - Date.now());
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data;
        return sanitizeApiErrorMessage(extractApiErrorMessage(responseData) || (error.response?.status ? `${fallback}：${error.response.status}` : fallback));
    }
    return sanitizeApiErrorMessage(error instanceof Error ? error.message : fallback);
}

function extractApiErrorMessage(input: unknown): string {
    if (!input) return "";
    if (typeof input === "string") return input.trim();
    if (typeof input !== "object") return "";
    const record = input as Record<string, unknown>;
    const direct = stringValue(record.msg) || stringValue(record.message) || stringValue(record.detail) || stringValue(record.reason) || stringValue(record.error_message) || stringValue(record.fail_reason);
    if (direct) return direct;
    if (typeof record.error === "string") return record.error.trim();
    return extractApiErrorMessage(record.error) || extractApiErrorMessage(record.data);
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    try {
        const payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; message?: string };
        if (typeof payload.code === "number" && ![0, 200].includes(payload.code)) throw new Error(payload.msg || payload.message || "视频下载失败");
    } catch (error) {
        if (error instanceof SyntaxError) return;
        throw error;
    }
}
