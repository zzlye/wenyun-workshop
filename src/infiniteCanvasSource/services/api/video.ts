// @ts-nocheck
import axios from "axios";

import { getDataUrlByteSize } from "@/lib/image-utils";
import { mediaToDataUrl, getMediaBlob } from "@/services/file-storage";
import { imageToDataUrl, getImageBlob } from "@/services/image-storage";
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

import { fetchVideoCapabilities, videoSelectionError, type VideoSelection } from "../../../lib/videoCapabilities";

type VideoTask = {
    id: string;
    status?: string;
    url?: string;
    videoUrl?: string;
    output?: unknown;
    media?: Array<{ url?: string; kind?: string }>;
    resultExpired?: boolean;
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
    let activeTaskId = taskReference?.taskId;
    try {
        // 恢复已有任务只查询编号，不重新读取可能已经移除的本地素材。
        const created = taskReference?.taskId ? { id: taskReference.taskId, status: "processing" } : unwrapVideoTask(await createVideoTask(source, await buildCanvasVideoPayload(config, prompt, references, audioReferences, videoReferences)));
        activeTaskId = created.id;
        if (!taskReference?.taskId && created.id) onTaskCreated?.({ taskId: created.id });
        const result = await waitForVideoResult(source, created);
        refreshRemoteUser(config);
        return result;
    } catch (error) {
        if (error instanceof VideoTaskPendingError) throw error;
        if (activeTaskId && !(error instanceof VideoTaskFailedError)) throw new VideoTaskPendingError(activeTaskId, `任务已保存，等待继续查询：${readAxiosError(error, "查询暂时中断")}`);
        throw new Error(readAxiosError(error, "视频生成失败"));
    }
}

// 创建请求只发送一次；字段和协议差异统一由 NewAPI 转换。
async function createVideoTask(source: VideoApiSource, payload: Record<string, unknown>) {
    return (await axios.post<VideoApiResponse>(videoApiUrl(source, "/videos"), payload, {
        headers: { ...videoApiHeaders(source), "Content-Type": "application/json", Prefer: "respond-async" },
        timeout: requestTimeout(source),
    })).data;
}

async function buildCanvasVideoPayload(config: AiConfig, prompt: string, references: ReferenceImage[], audioReferences: ReferenceAudio[], videoReferences: ReferenceVideo[]) {
    const model = normalizeCanvasVideoModel(config.videoModel || config.model);
    // 能力读取失败时中止本次创建并保留表单，不能把网络错误当成没有配置。
    const capability = await fetchVideoCapabilities(config.videoApiKey, Boolean(config.videoApiProxy), model);
    const resolution = normalizeCanvasVideoResolution(config.vquality);
    const mode = !config.videoMode || config.videoMode === "auto" ? (references.length + audioReferences.length + videoReferences.length ? "references" : "text") : config.videoMode;
    const selection: VideoSelection = {
        prompt: prompt.trim(), duration: normalizeCanvasVideoDuration(config.videoSeconds),
        resolution: resolution === "4k" ? "4k" : `${resolution}p`, aspect_ratio: normalizeCanvasVideoAspectRatio(config.size),
        mode, imageCount: references.length, audioCount: audioReferences.length, videoCount: videoReferences.length,
        generate_audio: config.videoGenerateAudio ?? undefined, extra_parameters: config.videoExtraParameters,
    };
    const error = videoSelectionError(capability, selection);
    if (error) throw new Error(error);
    if (!Number.isInteger(selection.duration) || selection.duration! < 1 || selection.duration! > 3600) throw new Error("视频时长应为 1 到 3600 的整数");
    if (!capability.configured && !selection.prompt) throw new Error("请输入视频提示词");
    if (mode === "text" && references.length + audioReferences.length + videoReferences.length) throw new Error("文生视频模式与已连接素材冲突，请调整生成模式");
    if (mode === "frames" && (references.length < 1 || references.length > 2)) throw new Error("首尾帧模式需要一张或两张图片，请调整素材数量");
    const payload: Record<string, unknown> = { model, prompt:selection.prompt, duration:selection.duration, resolution:selection.resolution, aspect_ratio:selection.aspect_ratio };
    if (selection.generate_audio !== undefined) payload.generate_audio = selection.generate_audio;
    if (capability.configured || mode === "frames") payload.mode = mode;
    if (Object.keys(config.videoExtraParameters ?? {}).length) payload.extra_parameters = config.videoExtraParameters;
    // 新服务逐个上传本地文件，生成请求只携带素材编号，不同时堆积多份 Base64。
    const images: unknown[] = [], videos: unknown[] = [], audios: unknown[] = [];
    for (const item of references) images.push(capability.configured ? await uploadVideoReference(config,item,"image") : await imageToVideoReferenceUrl(item));
    for (const item of videoReferences) videos.push(capability.configured ? await uploadVideoReference(config,item,"video") : await videoToReferenceUrl(item));
    for (const item of audioReferences) audios.push(capability.configured ? await uploadVideoReference(config,item,"audio") : await audioToVideoReferenceUrl(item));
    if ([...images,...audios,...videos].some(v => !v)) throw new Error("参考素材读取失败，请重新添加");
    if (mode === "frames") { payload.first_frame = images[0]; if (images.length === 2) payload.last_frame = images[1]; }
    else if (images.length) payload.image_urls = images;
    if (videos.length) payload.video_urls = videos;
    if (audios.length) payload.audio_urls = audios;
    return payload;
}

async function uploadVideoReference(config: AiConfig, item: ReferenceImage | ReferenceVideo | ReferenceAudio, kind: string) {
    if (/^https?:\/\//i.test(item.url || "")) return item.url;
    let blob: Blob | null = null;
    if (item.storageKey) blob = await (kind === "image" ? getImageBlob(item.storageKey) : getMediaBlob(item.storageKey));
    if (!blob) {
        const url = "dataUrl" in item && item.dataUrl || item.url;
        if (!url || !/^(data:|blob:)/.test(url)) throw new Error("本地素材已丢失，请重新添加");
        blob = await (await fetch(url)).blob();
    }
    const source = resolveVideoApiSource(config);
    const form = new FormData(); form.append("file", blob, item.name || kind);
    const response = await axios.post(videoApiUrl(source,"/video/assets"), form, {headers:videoApiHeaders(source), timeout:requestTimeout(source)});
    if (!response.data?.asset_id) throw new Error("素材上传未返回编号");
    return {asset_id:response.data.asset_id};
}

export class VideoTaskPendingError extends Error {
    constructor(public taskId: string, message = "任务仍在后台处理中，稍后继续查询") { super(message); this.name = "VideoTaskPendingError"; }
}
class VideoTaskFailedError extends Error {}

async function waitForVideoResult(source: VideoApiSource, created: VideoTask) {
    if (!created.id) throw new Error("视频接口没有返回任务 ID");
    let task = created;
    const deadline = Date.now() + VIDEO_TOTAL_TIMEOUT_MS;
    // NewAPI 后台任务和原生视频任务使用各自的查询端点，刷新后可根据编号直接恢复。
    const backgroundTask = created.id.startsWith("async_");
    const taskPath = `/${backgroundTask ? "tasks" : "videos"}/${encodeURIComponent(created.id)}`;

    for (;;) {
        if (isVideoStatusFailed(task.status)) throw new VideoTaskFailedError(task.error?.message || "视频生成失败");
        if (task.resultExpired) throw new VideoTaskFailedError("视频文件已过期，任务记录仍然保留");
        if (backgroundTask && isVideoStatusCompleted(task.status)) {
            const media = task.media?.find(item => item.kind === "video");
            const mediaPath = media?.url?.replace(/^\/v1/, "") || "";
            // 只携带鉴权访问当前任务的内容接口，不信任响应里任意外部地址。
            if (!mediaPath.startsWith(`${taskPath}/media/`) || !/^\d+$/.test(mediaPath.slice(`${taskPath}/media/`.length))) throw new Error("任务已完成，但没有返回可读取的视频文件");
            return requestVideoContent(videoApiUrl(source, mediaPath), source, remainingTimeout(deadline));
        }
        const videoUrl = findVideoUrl(task);
        if (!backgroundTask && videoUrl) return fetchVideoResultBlob(source, created.id, videoUrl, remainingTimeout(deadline));
        if (!backgroundTask && isVideoStatusCompleted(task.status)) return fetchVideoContent(source, created.id, remainingTimeout(deadline));

        const remaining = remainingTimeout(deadline);
        if (!remaining) throw new VideoTaskPendingError(created.id);
        await delayVideoPoll(Math.min(VIDEO_POLL_INTERVAL_MS, remaining));
        const nextRemaining = remainingTimeout(deadline);
        if (!nextRemaining) throw new VideoTaskPendingError(created.id);
        try {
            task = unwrapVideoTask((await axios.get<VideoApiResponse>(videoApiUrl(source, taskPath), {
                headers: videoApiHeaders(source),
                timeout: requestTimeout(source, nextRemaining),
            })).data);
        } catch (error) {
            // 断网、限流及暂时的服务错误只重试查询，绝不重新创建已扣费的任务。
            if (axios.isAxiosError(error) && (!error.response || [408, 429, 500, 502, 503, 504].includes(error.response.status))) continue;
            throw error;
        }
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
    if (!apiKey) throw new Error("视频 Key 尚未就绪，请在设置中查看或登录账号");
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

async function videoToReferenceUrl(video: ReferenceVideo) {
    const directUrl = (video.url || "").trim();
    // 公网地址直接引用；本地素材读取实际内容，避免把浏览器 blob 地址发送给服务器。
    try {
        const parsed = new URL(directUrl);
        if (["http:", "https:"].includes(parsed.protocol)) return parsed.href;
    } catch {
        // 无效地址与本地 blob 均在创建任务前报告，避免静默丢弃参考后扣费。
    }
    try {
        const dataUrl = await mediaToDataUrl(video);
        if (dataUrl?.startsWith("data:video/")) return dataUrl;
    } catch {
        // 素材读取失败必须中止创建，不能忽略参考视频继续计费。
    }
    throw new Error("参考视频读取失败，请重新添加视频素材");
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
        return { id, status, url, videoUrl: stringValue(record.videoUrl), output: record.output, media: Array.isArray(record.media) ? record.media : undefined, resultExpired: record.result_expired === true, error: errorMessage ? { message: errorMessage } : undefined };
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

function extractApiErrorMessage(input: unknown, depth = 0): string {
    if (depth > 6) return "";
    if (!input) return "";
    if (typeof input === "string") {
        const parsed = parseJsonString(input);
        return parsed ? extractApiErrorMessage(parsed, depth + 1) : input.trim();
    }
    if (typeof input !== "object") return "";
    const record = input as Record<string, unknown>;
    const direct = stringValue(record.msg) || stringValue(record.message) || stringValue(record.detail) || stringValue(record.reason) || stringValue(record.error_message) || stringValue(record.fail_reason);
    if (direct) return extractApiErrorMessage(direct, depth + 1);
    return extractApiErrorMessage(record.error, depth + 1) || extractApiErrorMessage(record.data, depth + 1);
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
