// @ts-nocheck
import axios from "axios";

import { getDataUrlByteSize } from "@/lib/image-utils";
import { mediaToDataUrl } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceAudio, ReferenceImage } from "@/types/image";
import { buildApiUrl as buildDevApiUrl, readClientDevProxyConfig, shouldUseApiProxyForBaseUrl } from "../../../lib/devProxy";
import { sanitizeApiErrorMessage } from "../../../lib/imageApiShared";
import { CANVAS_VIDEO_MODEL, CANVAS_VIDEO_RESOLUTION } from "../../../lib/videoModel";

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

const VIDEO_POLL_INTERVAL_MS = typeof process !== "undefined" && process.env.NODE_ENV === "test" ? 1 : 2500;
const VIDEO_REFERENCE_MAX_EDGE = 1920;
const VIDEO_REFERENCE_MAX_INLINE_BYTES = 8 * 1024 * 1024;
const VIDEO_REFERENCE_JPEG_QUALITY = 0.88;
const VIDEO_IMAGE_LIMIT = 9;
const VIDEO_AUDIO_LIMIT = 3;
const VIDEO_FILE_LIMIT = 12;

/**
 * 画布视频节点只调用 Seedance 2.0 的标准异步视频接口。
 * 创建、查询和下载都保持在同一套 /v1/videos 路径，避免旧模型兼容分支误发请求。
 */
export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], audioReferences: ReferenceAudio[] = []) {
    const source = resolveVideoApiSource(config);
    const payload = await buildSeedanceVideoPayload(config, prompt, references, audioReferences);

    try {
        const created = unwrapVideoTask((await axios.post<VideoApiResponse>(videoApiUrl(source, "/videos"), payload, {
            headers: { ...videoApiHeaders(source), "Content-Type": "application/json" },
            timeout: requestTimeout(source),
        })).data);
        const result = await waitForVideoResult(source, created);
        refreshRemoteUser(config);
        return result;
    } catch (error) {
        throw new Error(readAxiosError(error, "视频生成失败"));
    }
}

async function buildSeedanceVideoPayload(config: AiConfig, prompt: string, references: ReferenceImage[], audioReferences: ReferenceAudio[]) {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) throw new Error("请输入视频提示词");
    assertReferenceLimits(references, audioReferences);

    const payload: Record<string, unknown> = {
        model: CANVAS_VIDEO_MODEL,
        prompt: normalizedPrompt,
        aspect_ratio: normalizeVideoAspectRatio(config.size),
        resolution: CANVAS_VIDEO_RESOLUTION,
        seconds: normalizeVideoSeconds(config.videoSeconds),
    };

    const images = (await Promise.all(references.map(imageToVideoReferenceUrl))).filter(Boolean);
    if (images.length) {
        // 第一张图作为主参考图，其余图片按文档放入额外参考图数组。
        payload.image_url = images[0];
        if (images.length > 1) payload.reference_image_urls = images.slice(1);
    }

    const audios = (await Promise.all(audioReferences.map(audioToVideoReferenceUrl))).filter(Boolean);
    if (audios.length) {
        payload.audio_url = audios[0];
        // 接口允许多音频时同时提交数组；单音频仍只发送文档中的 audio_url。
        if (audios.length > 1) payload.audio_urls = audios;
    }

    return payload;
}

function assertReferenceLimits(references: ReferenceImage[], audioReferences: ReferenceAudio[]) {
    if (references.length > VIDEO_IMAGE_LIMIT) throw new Error(`视频参考图最多连接 ${VIDEO_IMAGE_LIMIT} 张`);
    if (audioReferences.length > VIDEO_AUDIO_LIMIT) throw new Error(`视频参考音频最多连接 ${VIDEO_AUDIO_LIMIT} 个`);
    if (references.length + audioReferences.length > VIDEO_FILE_LIMIT) throw new Error(`视频参考文件总数最多 ${VIDEO_FILE_LIMIT} 个`);
    if (audioReferences.length && !references.length) throw new Error("视频参考音频必须同时连接至少一张参考图");

    const invalidDuration = audioReferences.find((audio) => typeof audio.duration === "number" && (audio.duration <= 2 || audio.duration >= 15));
    if (invalidDuration) throw new Error("视频参考音频时长需要大于 2 秒且小于 15 秒");
}

async function waitForVideoResult(source: VideoApiSource, created: VideoTask) {
    if (!created.id) throw new Error("视频接口没有返回任务 ID");
    let task = created;

    for (;;) {
        const videoUrl = findVideoUrl(task);
        if (videoUrl) return fetchVideoResultBlob(source, created.id, videoUrl);
        if (isVideoStatusCompleted(task.status)) return fetchVideoContent(source, created.id);
        if (isVideoStatusFailed(task.status)) throw new Error(task.error?.message || "视频生成失败");

        await delayVideoPoll();
        task = unwrapVideoTask((await axios.get<VideoApiResponse>(videoApiUrl(source, `/videos/${created.id}`), {
            headers: videoApiHeaders(source),
            timeout: requestTimeout(source),
        })).data);
    }
}

async function fetchVideoContent(source: VideoApiSource, taskId: string) {
    const response = await axios.get<Blob>(videoApiUrl(source, `/videos/${taskId}/content`), {
        headers: videoApiHeaders(source),
        responseType: "blob",
        timeout: requestTimeout(source),
    });
    await assertVideoBlob(response.data);
    return response.data;
}

// 优先使用带鉴权的 content 下载端点，避免外部视频地址被浏览器跨域策略拦截。
async function fetchVideoResultBlob(source: VideoApiSource, taskId: string, videoUrl: string) {
    try {
        return await fetchVideoContent(source, taskId);
    } catch (error) {
        if (!shouldFallbackToDirectVideoUrl(error)) throw error;
    }

    const response = await fetch(videoUrl, {
        cache: "no-store",
        headers: shouldSendVideoDownloadAuth(source, videoUrl) ? videoApiHeaders(source) : undefined,
    });
    if (!response.ok) throw new Error(`视频 URL 下载失败：HTTP ${response.status}`);
    const blob = await response.blob();
    await assertVideoBlob(blob);
    return blob;
}

function resolveVideoApiSource(config: AiConfig): VideoApiSource {
    const baseUrl = config.videoBaseUrl.trim().replace(/\/+$/, "");
    const apiKey = config.videoApiKey.trim();
    if (!baseUrl || !apiKey) throw new Error("请先在设置里填写视频 API URL 和 Key");
    return {
        baseUrl,
        apiKey,
        apiProxy: Boolean(config.videoApiProxy),
        timeout: Number(config.videoTimeout || config.timeout),
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

function requestTimeout(source: VideoApiSource) {
    return Math.max(10, source.timeout || 120) * 1000;
}

function refreshRemoteUser(config: AiConfig) {
    if (config.channelMode === "remote") void useUserStore.getState().hydrateUser();
}

function normalizeVideoSeconds(value: string) {
    return Number(value) >= 15 ? "15" : "10";
}

function normalizeVideoAspectRatio(value: string) {
    const ratio = readVideoAspectRatio(value);
    return ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"].includes(ratio) ? ratio : "16:9";
}

function readVideoAspectRatio(value: string) {
    const trimmed = (value || "").trim();
    if (["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"].includes(trimmed)) return trimmed;
    if (!/^\d+x\d+$/.test(trimmed)) return "16:9";

    const [width, height] = trimmed.split("x").map(Number);
    if (!width || !height) return "16:9";
    if (Math.abs(width - height) / Math.max(width, height) < 0.02) return "1:1";
    const ratio = width / height;
    if (ratio >= 2) return "21:9";
    if (ratio >= 1.5) return "16:9";
    if (ratio >= 1.15) return "4:3";
    if (ratio <= 0.65) return "9:16";
    if (ratio <= 0.85) return "3:4";
    return "16:9";
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
    return normalizeVideoReferenceAudioDataUrl(dataUrl, audio.duration);
}

async function normalizeVideoReferenceAudioDataUrl(dataUrl: string, knownDuration?: number) {
    const audioContextType = typeof AudioContext !== "undefined" ? AudioContext : typeof webkitAudioContext !== "undefined" ? webkitAudioContext : null;
    if (!audioContextType) {
        assertVideoReferenceAudioDuration(knownDuration);
        return dataUrl;
    }

    const blob = await (await fetch(dataUrl)).blob();
    const context = new audioContextType();
    try {
        const buffer = await context.decodeAudioData(await blob.arrayBuffer());
        assertVideoReferenceAudioDuration(buffer.duration);
        // 本地音频统一转换为 WAV，减少浏览器录音格式被上游拒绝的情况。
        return audioBufferToWavDataUrl(buffer);
    } finally {
        void context.close?.();
    }
}

function assertVideoReferenceAudioDuration(duration?: number) {
    if (typeof duration !== "number" || !Number.isFinite(duration)) return;
    if (duration <= 2 || duration >= 15) throw new Error("视频参考音频时长需要大于 2 秒且小于 15 秒");
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
    if (!axios.isAxiosError(error)) return true;
    return !error.response || [400, 404, 405].includes(error.response.status || 0);
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

function delayVideoPoll() {
    return new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
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
