// @ts-nocheck
import axios from "axios";

import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceAudio, ReferenceImage, ReferenceVideo } from "@/types/image";
import { buildApiUrl as buildDevApiUrl, getLockedAssetProxyUrl, readClientDevProxyConfig, shouldUseApiProxyForBaseUrl } from "../../../lib/devProxy";
import { sanitizeApiErrorMessage } from "../../../lib/imageApiShared";
import { flushCanvasStorePersistence } from "../../app/(user)/canvas/stores/use-canvas-store";
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
    phase?: "downloading" | "saving";
};

const VIDEO_POLL_INTERVAL_MS = typeof process !== "undefined" && process.env.NODE_ENV === "test" ? 1 : 5000;
const VIDEO_TOTAL_TIMEOUT_MS = CANVAS_VIDEO_TIMEOUT * 1000;
// 生成等待窗口与单次查询分开，避免一条卡住的查询阻塞后续完成状态。
const VIDEO_STATUS_TIMEOUT_MS = 30_000;
const VIDEO_DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

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
        if (!taskReference?.taskId && created.id) {
            onTaskCreated?.({ taskId: created.id });
            await flushCanvasStorePersistence();
        }
        const result = await waitForVideoResult(source, created, () => onTaskCreated?.({ taskId: created.id, phase: "downloading" }));
        onTaskCreated?.({ taskId: created.id, phase: "saving" });
        refreshRemoteUser(config);
        return result;
    } catch (error) {
        if (error instanceof VideoTaskPendingError) throw error;
        const permanentHttpError = axios.isAxiosError(error) && [400, 401, 403, 404, 410, 422].includes(error.response?.status);
        if (activeTaskId && !(error instanceof VideoTaskFailedError) && !(error instanceof VideoTaskResultError) && !permanentHttpError) throw new VideoTaskPendingError(activeTaskId, `任务已保存，等待继续查询：${readAxiosError(error, "查询暂时中断")}`);
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
    // 所有模型统一先上传，生成请求只携带 URL；能力配置不能决定素材传输方式。
    const images: unknown[] = [], videos: unknown[] = [], audios: unknown[] = [];
    const uploaded = new Map<string, string>();
    const prepare = async (item: ReferenceImage | ReferenceVideo | ReferenceAudio, kind: string) => {
        const key = `${kind}:${item.storageKey || ("dataUrl" in item && item.dataUrl) || item.url || item.id}`;
        if (!uploaded.has(key)) uploaded.set(key, await uploadVideoReference(config, item, kind));
        return uploaded.get(key)!;
    };
    for (const item of references) images.push(await prepare(item,"image"));
    for (const item of videoReferences) videos.push(await prepare(item,"video"));
    for (const item of audioReferences) audios.push(await prepare(item,"audio"));
    if ([...images,...audios,...videos].some(v => !v)) throw new Error("参考素材读取失败，请重新添加");
    if (mode === "frames") { payload.first_frame = images[0]; if (images.length === 2) payload.last_frame = images[1]; }
    else if (images.length) payload.image_urls = images;
    if (videos.length) payload.video_urls = videos;
    if (audios.length) payload.audio_urls = audios;
    return payload;
}

async function uploadVideoReference(config: AiConfig, item: ReferenceImage | ReferenceVideo | ReferenceAudio, kind: string) {
    const direct = (item.url || "").trim();
    if (/^https?:\/\//i.test(direct)) {
        const url = new URL(direct);
        if (url.username || url.password) throw new Error("参考素材链接不应包含登录凭据");
        return direct;
    }
    let blob: Blob | null = null;
    try {
        if (item.storageKey) blob = await (kind === "image" ? getImageBlob(item.storageKey) : getMediaBlob(item.storageKey));
        if (!blob) {
            const url = "dataUrl" in item && item.dataUrl || item.url;
            if (!url || !/^(data:|blob:)/.test(url)) throw new Error();
            const response = await fetch(url);
            if (!response.ok) throw new Error();
            blob = await response.blob();
        }
    } catch {
        throw new Error(`参考${kind === "video" ? "视频" : kind === "audio" ? "音频" : "图片"}读取失败，请重新添加素材`);
    }
    if (!blob.size || blob.size > 200 * 1024 * 1024) throw new Error("参考素材为空或超过 200MB，请重新添加");
    const contentType = blob.type || item.type;
    if (!contentType?.startsWith(`${kind}/`)) throw new Error("参考素材类型不正确，请重新添加");
    const source = resolveVideoApiSource(config);
    const response = await axios.post("/image-tasks/media-reference-uploads", blob, {
        headers: { ...videoApiHeaders(source), "Content-Type": contentType }, timeout: 180000,
    });
    const value = response.data?.url;
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) throw new Error("素材上传未返回可用的公网地址");
    const url = new URL(value);
    if (url.username || url.password || url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") throw new Error("素材上传未返回可用的公网地址");
    return value;
}

export class VideoTaskPendingError extends Error {
    constructor(public taskId: string, message = "任务仍在后台处理中，稍后继续查询") { super(message); this.name = "VideoTaskPendingError"; }
}
class VideoTaskFailedError extends Error {}
// 完成结果本身不合法时必须显示错误，不能再伪装成后台仍在生成。
class VideoTaskResultError extends Error {}

function resolveVideoTaskMediaPath(source: VideoApiSource, taskPath: string, value: unknown) {
    if (typeof value === "string" && (/^https?:\/\//i.test(value) || /^\/(?!\/)/.test(value))) {
        try {
            const target = new URL(value, source.baseUrl);
            const path = target.pathname.replace(/^\/v1(?=\/)/, "");
            const prefix = `${taskPath}/media/`;
            // 新版返回绝对地址、旧版返回相对地址；只取本次任务的数字索引，实际下载仍重建到配置的代理。
            if (["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash
                && path.startsWith(prefix) && /^\d+$/.test(path.slice(prefix.length))) return `${prefix}${path.slice(prefix.length)}`;
        } catch {
            // 无效地址交给结果错误处理，不能把解析异常当作网络中断而无限续查。
        }
    }
    throw new VideoTaskResultError("任务已完成，但没有返回可读取的视频文件");
}

async function waitForVideoResult(source: VideoApiSource, created: VideoTask, onDownloading?: () => void) {
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
            const mediaPath = resolveVideoTaskMediaPath(source, taskPath, media?.url);
            onDownloading?.();
            return fetchVideoContentPath(source, mediaPath);
        }
        const videoUrl = findVideoUrl(task);
        // 完成后开启独立下载窗口，不能把耗尽的轮询预算作为 axios 的无限等待值 0。
        if (!backgroundTask && (videoUrl || isVideoStatusCompleted(task.status))) {
            onDownloading?.();
            return videoUrl ? fetchVideoResultBlob(source, created.id, videoUrl) : fetchVideoContent(source, created.id);
        }

        const remaining = remainingTimeout(deadline);
        if (!remaining) throw new VideoTaskPendingError(created.id);
        await delayVideoPoll(Math.min(VIDEO_POLL_INTERVAL_MS, remaining));
        const nextRemaining = remainingTimeout(deadline);
        if (!nextRemaining) throw new VideoTaskPendingError(created.id);
        try {
            task = unwrapVideoTask((await axios.get<VideoApiResponse>(videoApiUrl(source, taskPath), {
                headers: videoApiHeaders(source),
                timeout: Math.min(VIDEO_STATUS_TIMEOUT_MS, requestTimeout(source, nextRemaining)),
            })).data);
        } catch (error) {
            // 断网、限流及暂时的服务错误只重试查询，绝不重新创建已扣费的任务。
            if (axios.isAxiosError(error) && (!error.response || [408, 429, 500, 502, 503, 504].includes(error.response.status))) continue;
            throw error;
        }
    }
}

async function fetchVideoContent(source: VideoApiSource, taskId: string, timeoutMs = requestTimeout(source)) {
    return fetchVideoContentPath(source, `/videos/${encodeURIComponent(taskId)}/content`, timeoutMs);
}

// 原生视频和后台任务复用同源下载回退，继续读取同一份已完成结果。
async function fetchVideoContentPath(source: VideoApiSource, contentPath: string, timeoutMs = requestTimeout(source)) {
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
    const controller = new AbortController();
    let loaded = 0;
    let idleTimer: ReturnType<typeof setTimeout>;
    const resetIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), VIDEO_DOWNLOAD_IDLE_TIMEOUT_MS);
    };
    resetIdleTimer();
    try {
        const response = await axios.get<Blob>(url, {
            headers: videoApiHeaders(source),
            responseType: "blob",
            timeout: Math.max(1000, timeoutMs),
            signal: controller.signal,
            onDownloadProgress: progress => {
                // 只有实际收到更多字节才续期；正常慢速下载仍可使用完整下载窗口。
                if (progress.loaded > loaded) { loaded = progress.loaded; resetIdleTimer(); }
            },
        });
        await assertVideoBlob(response.data);
        return response.data;
    } finally {
        clearTimeout(idleTimer);
    }
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
    const timeoutId = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    let idleTimer: ReturnType<typeof setTimeout>;
    const resetIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), VIDEO_DOWNLOAD_IDLE_TIMEOUT_MS);
    };
    resetIdleTimer();
    try {
        const response = await fetch(downloadUrl, {
            cache: "no-store",
            headers: shouldSendVideoDownloadAuth(source, videoUrl) ? videoApiHeaders(source) : undefined,
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`视频 URL 下载失败：HTTP ${response.status}`);
        // URL 回退下载同样监测字节进度，不能在第三条路径重新陷入长时间空等。
        let blob: Blob;
        if (response.body) {
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value.byteLength) { chunks.push(value); resetIdleTimer(); }
                }
            } finally { reader.releaseLock(); }
            blob = new Blob(chunks, { type: response.headers.get("Content-Type") || "video/mp4" });
        } else {
            blob = await response.blob();
        }
        await assertVideoBlob(blob);
        return blob;
    } catch (error) {
        if (controller.signal.aborted) throw new Error("视频结果下载超时");
        throw error;
    } finally {
        clearTimeout(timeoutId);
        clearTimeout(idleTimer);
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
