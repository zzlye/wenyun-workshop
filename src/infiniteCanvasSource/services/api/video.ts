// @ts-nocheck
import axios from "axios";

import { dataUrlToFile, getDataUrlByteSize } from "@/lib/image-utils";
import { mediaToDataUrl } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceAudio, ReferenceImage } from "@/types/image";
import { buildApiUrl as buildDevApiUrl, readClientDevProxyConfig, shouldUseApiProxyForBaseUrl } from "../../../lib/devProxy";
import { sanitizeApiErrorMessage } from "../../../lib/imageApiShared";

type VideoResponse = { id?: string; status?: string; url?: string; video_url?: string; videoUrl?: string; output?: unknown; error?: { message?: string } };
type ApiVideoResponse = VideoResponse | { code?: number; data?: VideoResponse | null; msg?: string };
type NewApiVideoTask = { id: string; status?: string; url?: string; videoUrl?: string; output?: unknown; error?: { message?: string } };
type NewApiVideoResponse = NewApiVideoTask | { code?: number; data?: unknown; msg?: string; error?: { message?: string } };
type VideoApiSource = { label: string; baseUrl: string; apiKey: string; apiProxy: boolean; timeout: number; versioned: boolean };

const VIDEO_POLL_INTERVAL_MS = typeof process !== "undefined" && process.env.NODE_ENV === "test" ? 1 : 2500;
const VIDEO_REFERENCE_MAX_EDGE = 1920;
const VIDEO_REFERENCE_MAX_INLINE_BYTES = 8 * 1024 * 1024;
const VIDEO_REFERENCE_JPEG_QUALITY = 0.88;

class VideoAttemptError extends Error {
    readonly label: string;

    constructor(message: string, label: string) {
        super(message);
        this.name = "VideoAttemptError";
        this.label = label;
    }
}

function resolveVideoApiSources(config: AiConfig): VideoApiSource[] {
    const candidates = [
        {
            label: "视频 API",
            baseUrl: config.videoBaseUrl.trim(),
            apiKey: config.videoApiKey.trim(),
            apiProxy: Boolean(config.videoApiProxy),
            timeout: Number(config.videoTimeout || config.timeout),
        },
    ];
    const sources: VideoApiSource[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
        if (!candidate.baseUrl || !candidate.apiKey) continue;
        const normalizedBaseUrl = candidate.baseUrl.replace(/\/+$/, "");
        const key = `${normalizedBaseUrl}|${candidate.apiKey}|${candidate.apiProxy}`;
        if (!seen.has(key)) {
            seen.add(key);
            sources.push({ ...candidate, baseUrl: normalizedBaseUrl, versioned: true });
        }
        if (/\/v1$/i.test(normalizedBaseUrl) && !candidate.apiProxy) {
            const unversionedBaseUrl = normalizedBaseUrl.replace(/\/v1$/i, "");
            const unversionedKey = `${unversionedBaseUrl}|${candidate.apiKey}|${candidate.apiProxy}|no-v1`;
            if (!seen.has(unversionedKey)) {
                seen.add(unversionedKey);
                sources.push({ ...candidate, label: `${candidate.label}(无 /v1)`, baseUrl: unversionedBaseUrl, versioned: false });
            }
        }
    }
    return sources;
}

function aiApiUrl(config: AiConfig, source: VideoApiSource, path: string) {
    if (config.channelMode === "remote" && !source.baseUrl) return `/api/v1${path}`;

    const proxyConfig = readClientDevProxyConfig();
    if (shouldUseApiProxyForBaseUrl(source.apiProxy, source.baseUrl, proxyConfig)) return buildDevApiUrl(source.baseUrl, path, proxyConfig, true);
    if (source.versioned) return buildDevApiUrl(source.baseUrl, path, proxyConfig, false);
    const endpointPath = path.replace(/^\/+/, "");
    return source.baseUrl ? `${source.baseUrl}/${endpointPath}` : `/${endpointPath}`;
}

function aiHeaders(config: AiConfig, source: VideoApiSource) {
    const token = useUserStore.getState().token;
    const apiKey = source.apiKey;
    return config.channelMode === "remote" && !source.baseUrl ? (token ? { Authorization: `Bearer ${token}` } : undefined) : { Authorization: `Bearer ${apiKey}` };
}

function refreshRemoteUser(config: AiConfig) {
    if (config.channelMode === "remote" && !config.videoBaseUrl.trim()) void useUserStore.getState().hydrateUser();
}

function requestTimeout(source: VideoApiSource) {
    return Math.max(1, source.timeout || 120) * 1000;
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], audioReferences: ReferenceAudio[] = []) {
    const model = config.videoModel || config.model;
    const sources = resolveVideoApiSources(config);
    if (!sources.length) throw new Error("请先在设置里填写支持视频生成的 API URL 和 Key");
    const failures: VideoAttemptError[] = [];
    const tryGeneration = async <T>(label: string, task: () => Promise<T>, shouldContinue: (error: unknown) => boolean) => {
        try {
            return await task();
        } catch (error) {
            const message = readAxiosError(error, "视频生成失败");
            failures.push(new VideoAttemptError(message, label));
            if (!shouldContinue(error) && !isCompatibleVideoFallbackMessage(message)) throw buildVideoGenerationError(failures);
            return null;
        }
    };

    for (const source of sources) {
        const labelPrefix = `${formatVideoSourceLabel(source, model)} `;
        if (isBafangGrokImagineVideo15Model(model)) {
            const result = await tryGeneration(`${labelPrefix}八方 Grok /videos/generations`, () => requestBafangGrokImagineVideoGeneration(config, source, prompt, references, model), () => false);
            if (result) return result;
            continue;
        }

        if (isChatCompletionsFirstModel(model)) {
            const result = await tryGeneration(`${labelPrefix}聊天兼容 /chat/completions`, () => requestChatCompletionsVideoGeneration(config, source, prompt, references, model), shouldFallbackToNextVideoSource);
            if (result) return result;
        }

        if (isJsonVideosFirstModel(model)) {
            const result = await tryGeneration(`${labelPrefix}OpenAI JSON /videos`, () => requestOpenAiVideosJsonGeneration(config, source, prompt, references, audioReferences, model), shouldFallbackToNextVideoSource);
            if (result) return result;
        }

        // GeekNow 的 Grok Pro 需要 multipart /videos，不能先走聊天接口。
        if (isGrokVideosMultipartModel(model)) {
            const result = await tryGeneration(`${labelPrefix}OpenAI multipart /videos`, () => requestOpenAiVideosMultipartGeneration(config, source, prompt, references, model, false), shouldFallbackToNextVideoSource);
            if (result) return result;
        }

        const taskResult = await tryGeneration(`${labelPrefix}NewAPI 任务 /video/generations`, () => requestNewApiVideoGeneration(config, source, prompt, references, model), shouldFallbackToNextVideoSource);
        if (taskResult) return taskResult;

        if (!isGrokVideosMultipartModel(model)) {
            const openAiResult = await tryGeneration(`${labelPrefix}OpenAI multipart /videos`, () => requestOpenAiVideosMultipartGeneration(config, source, prompt, references, model, !isJsonVideosFirstModel(model)), shouldFallbackToNextVideoSource);
            if (openAiResult) return openAiResult;
        }

        const chatResult = await tryGeneration(`${labelPrefix}聊天兼容 /chat/completions`, () => requestChatCompletionsVideoGeneration(config, source, prompt, references, model), shouldFallbackToNextVideoSource);
        if (chatResult) return chatResult;
    }

    throw buildVideoGenerationError(failures);
}

async function requestBafangGrokImagineVideoGeneration(config: AiConfig, source: VideoApiSource, prompt: string, references: ReferenceImage[], model: string) {
    const reference = references[0];
    if (!reference) throw new Error("Grok 1.5 视频只支持图生视频，请先连接或添加首帧参考图");
    const imageUrl = await imageToDataUrl(reference);
    if (!imageUrl) throw new Error("Grok 1.5 视频首帧参考图读取失败，请重新上传或替换这张图片后重试");
    const payload = {
        model,
        prompt,
        image: { url: imageUrl },
        duration: Number(normalizeVideoSecondsForModel(config.videoSeconds, model)),
        aspect_ratio: normalizeVideoAspectRatio(config.size, model),
    };
    const created = unwrapVideoTask((await axios.post<ApiVideoResponse>(aiApiUrl(config, source, "/videos/generations"), payload, { headers: { ...aiHeaders(config, source), "Content-Type": "application/json" }, timeout: requestTimeout(source) })).data);
    return waitOpenAiVideoResult(config, source, created, model);
}

async function requestOpenAiVideosJsonGeneration(config: AiConfig, source: VideoApiSource, prompt: string, references: ReferenceImage[], audioReferences: ReferenceAudio[], model: string) {
    const seconds = normalizeVideoSecondsForModel(config.videoSeconds, model);
    const payload: Record<string, unknown> = isGeekNowSoraModel(model)
        ? { model, prompt, size: normalizeSoraVideoSize(config.size, model), seconds }
        : {
              model,
              prompt,
              aspect_ratio: normalizeVideoAspectRatio(config.size, model),
              duration: Number(seconds),
              seconds,
              size: normalizeVideoSize(config.size) || undefined,
              resolution: normalizeVideoResolutionForModel(config.vquality, model),
              generate_audio: true,
          };
    const images = (await Promise.all(references.slice(0, getJsonVideoReferenceLimit(model)).map((image) => imageToDataUrl(image)))).filter(Boolean);
    appendJsonVideoReferenceFields(payload, images, model);
    assertJsonVideoAudioReferences(model, images, audioReferences);
    const audios = await prepareJsonVideoAudioUrls(model, audioReferences);
    appendJsonVideoAudioFields(payload, audios);
    const created = unwrapVideoTask((await axios.post<ApiVideoResponse>(aiApiUrl(config, source, "/videos"), payload, { headers: { ...aiHeaders(config, source), "Content-Type": "application/json" }, timeout: requestTimeout(source) })).data);
    return waitOpenAiVideoResult(config, source, created, model);
}

async function requestOpenAiVideosMultipartGeneration(config: AiConfig, source: VideoApiSource, prompt: string, references: ReferenceImage[], model: string, includeLegacyFields: boolean) {
    const body = new FormData();
    body.append("model", model);
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSecondsForModel(config.videoSeconds, model));
    body.append("duration", normalizeVideoSecondsForModel(config.videoSeconds, model));
    body.append("aspect_ratio", normalizeVideoAspectRatio(config.size, model));
    body.append("resolution", normalizeVideoResolutionForModel(config.vquality, model));
    if (normalizeVideoSize(config.size)) body.append("size", normalizeVideoSize(config.size)!);
    if (includeLegacyFields) {
        body.append("resolution_name", normalizeVideoResolutionForModel(config.vquality, model));
        body.append("preset", "normal");
    }
    const files = await Promise.all(references.slice(0, 7).map((image) => imageToVideoReferenceFile(image)));
    files.forEach((file) => body.append(includeLegacyFields ? "input_reference[]" : "input_reference", file));
    const created = unwrapVideoTask((await axios.post<ApiVideoResponse>(aiApiUrl(config, source, "/videos"), body, { headers: aiHeaders(config, source), timeout: requestTimeout(source) })).data);
    return waitOpenAiVideoResult(config, source, created, model);
}

async function waitOpenAiVideoResult(config: AiConfig, source: VideoApiSource, created: NewApiVideoTask, model: string) {
    if (!created.id) throw new Error("视频接口没有返回任务 ID");
    let task = created;
    for (;;) {
        const videoUrl = findVideoUrl(task);
        if (videoUrl) {
            const blob = await fetchVideoResultBlob(config, source, created.id, videoUrl);
            refreshRemoteUser(config);
            return blob;
        }
        if (isVideoStatusCompleted(task.status)) break;
        if (isVideoStatusFailed(task.status)) throw new Error(task.error?.message || "视频生成失败");
        await delayVideoPoll();
        task = unwrapVideoTask((await axios.get<ApiVideoResponse>(aiApiUrl(config, source, `/videos/${created.id}`), { headers: aiHeaders(config, source), params: config.channelMode === "remote" ? { model } : undefined, timeout: requestTimeout(source) })).data);
    }
    const content = await axios.get<Blob>(aiApiUrl(config, source, `/videos/${created.id}/content`), { headers: aiHeaders(config, source), params: config.channelMode === "remote" ? { model } : undefined, responseType: "blob", timeout: requestTimeout(source) });
    await assertVideoBlob(content.data);
    refreshRemoteUser(config);
    return content.data;
}

async function requestChatCompletionsVideoGeneration(config: AiConfig, source: VideoApiSource, prompt: string, references: ReferenceImage[], model: string) {
    const content = await buildChatVideoContent(config, prompt, references);
    const response = await axios.post(
        aiApiUrl(config, source, "/chat/completions"),
        {
            model,
            messages: [{ role: "user", content }],
            stream: false,
            temperature: 0.7,
        },
        { headers: { ...aiHeaders(config, source), "Content-Type": "application/json" }, timeout: requestTimeout(source) },
    );
    const videoUrl = findVideoUrl(response.data);
    if (!videoUrl) throw new Error("视频接口没有返回视频地址");
    const videoResponse = await fetchVideoResultBlob(config, source, "", videoUrl);
    refreshRemoteUser(config);
    return videoResponse;
}

async function requestNewApiVideoGeneration(config: AiConfig, source: VideoApiSource, prompt: string, references: ReferenceImage[], model: string) {
    const seconds = normalizeVideoSecondsForModel(config.videoSeconds, model);
    const payload: Record<string, unknown> = {
        model,
        prompt,
        aspect_ratio: normalizeVideoAspectRatio(config.size, model),
        duration: Number(seconds),
        seconds,
        size: normalizeVideoSize(config.size) || undefined,
        resolution: normalizeVideoResolutionForModel(config.vquality, model),
        generate_audio: true,
    };
    const images = (await Promise.all(references.slice(0, 7).map((image) => imageToDataUrl(image)))).filter(Boolean);
    if (images.length) payload.image = isBafangGrokImagineVideo15Model(model) ? { url: images[0] } : images.length === 1 ? images[0] : images;

    const created = unwrapNewApiVideoResponse((await axios.post<NewApiVideoResponse>(aiApiUrl(config, source, "/video/generations"), payload, { headers: { ...aiHeaders(config, source), "Content-Type": "application/json" }, timeout: requestTimeout(source) })).data);
    if (!created.id) throw new Error("视频接口没有返回任务 ID");

    let task = created;
    for (;;) {
        if (isVideoTaskCompleted(task)) break;
        if (isVideoTaskFailed(task)) throw new Error(task.error?.message || "视频生成失败");
        await delayVideoPoll();
        task = unwrapNewApiVideoResponse((await axios.get<NewApiVideoResponse>(aiApiUrl(config, source, `/video/generations/${created.id}`), { headers: aiHeaders(config, source), timeout: requestTimeout(source) })).data);
    }

    const videoUrl = findVideoUrl(task);
    if (!videoUrl) throw new Error("视频接口没有返回视频地址");
    const response = await fetchVideoResultBlob(config, source, created.id || task.id, videoUrl);
    refreshRemoteUser(config);
    return response;
}

async function buildChatVideoContent(config: AiConfig, prompt: string, references: ReferenceImage[]) {
    const model = config.videoModel || config.model;
    const settingsText = `视频参数：${normalizeVideoSecondsForModel(config.videoSeconds, model)}秒，${normalizeVideoResolutionForModel(config.vquality, model)}，${videoAspectLabel(config.size)}。`;
    const text = isChatCompletionsFirstModel(model) ? prompt : `${settingsText}\n\n${prompt}`;
    const images = (await Promise.all(references.slice(0, 7).map((image) => imageToDataUrl(image)))).filter(Boolean);
    if (!images.length) return text;
    return [{ type: "text", text }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))];
}

function videoAspectLabel(value: string) {
    if (value === "auto" || !value) return "自动比例";
    if (/^\d+x\d+$/.test(value)) {
        const [w, h] = value.split("x").map(Number);
        if (w && h) return w >= h ? "横屏" : "竖屏";
    }
    if (["9:16", "2:3", "3:4"].includes(value)) return "竖屏";
    return "横屏";
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSecondsForModel(value: string, model: string) {
    const seconds = Math.floor(Number(value) || 6);
    if (isSora2VideoModel(model)) {
        // Sora 2 只接受 4、8、12 秒，避免旧节点保存的 6s/10s 继续发出后被接口拒绝。
        if (seconds <= 4) return "4";
        if (seconds >= 12) return "12";
        return "8";
    }
    if (isSoraV3VideoModel(model)) return String(Math.max(4, Math.min(15, seconds)));
    if (isVeo31FastVideoModel(model)) {
        if (seconds <= 4) return "4";
        if (seconds >= 8) return "8";
        return "6";
    }
    if (isBafangGrokImagineVideo15Model(model)) return String(Math.max(1, Math.min(15, seconds)));
    if (isKlingVideoModel(model)) return String(Math.max(3, Math.min(15, seconds)));
    return normalizeVideoSeconds(value);
}

function normalizeVideoAspectRatio(value: string, model: string) {
    const ratio = readVideoAspectRatio(value);
    if (isSora2VideoModel(model) || isVeo31FastVideoModel(model)) return ratio === "9:16" ? "9:16" : "16:9";
    if (isKlingVideoModel(model)) return ["1:1", "9:16"].includes(ratio) ? ratio : "16:9";
    if (isBafangGrokImagineVideo15Model(model)) return ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"].includes(ratio) ? ratio : "16:9";
    if (isSoraV3VideoModel(model)) {
        if (["21:9", "1:1", "4:3", "3:4", "16:9", "9:16"].includes(ratio)) return ratio;
        return "16:9";
    }
    return ratio;
}

function readVideoAspectRatio(value: string) {
    const trimmed = (value || "").trim();
    if (/^\d+:\d+$/.test(trimmed)) return trimmed;
    if (/^\d+x\d+$/.test(trimmed)) {
        const [width, height] = trimmed.split("x").map(Number);
        if (width && height) {
            if (Math.abs(width - height) / Math.max(width, height) < 0.02) return "1:1";
            const ratio = width / height;
            if (Math.abs(ratio - 21 / 9) < 0.03) return "21:9";
            if (Math.abs(ratio - 16 / 9) < 0.03) return "16:9";
            if (Math.abs(ratio - 9 / 16) < 0.03) return "9:16";
            if (Math.abs(ratio - 4 / 3) < 0.03) return "4:3";
            if (Math.abs(ratio - 3 / 4) < 0.03) return "3:4";
            if (Math.abs(ratio - 3 / 2) < 0.03) return "3:2";
            if (Math.abs(ratio - 2 / 3) < 0.03) return "2:3";
            if (ratio >= 2) return "21:9";
            if (ratio >= 1.5) return "16:9";
            if (ratio >= 1.15) return "4:3";
            if (ratio <= 0.5) return "9:16";
            if (ratio <= 0.85) return "3:4";
        }
    }
    if (["9:16", "2:3", "3:4"].includes(trimmed)) return "9:16";
    return "16:9";
}

function appendJsonVideoReferenceFields(payload: Record<string, unknown>, images: string[], model: string) {
    if (!images.length) return;
    if (isGeekNowSoraModel(model)) {
        payload.input_reference = images.length === 1 ? images[0] : images;
        return;
    }
    if (isPixelleJsonVideoModel(model)) {
        // Pixelle/Sora V3 风格接口使用 image_url 作为主参考图，reference_image_urls 作为额外参考图。
        payload.image_url = images[0];
        if (images.length > 1) payload.reference_image_urls = images.slice(1);
        payload.image_urls = images;
        return;
    }
    if (isStandardJsonVideoModel(model)) {
        payload.image_urls = images;
        return;
    }
    if (isBafangGrokImagineVideo15Model(model)) {
        payload.image = { url: images[0] };
        return;
    }
    // 部分 NewAPI 中转站的旧 Sora/Veo 图生视频不接受 multipart，但接受这组 JSON 图片字段。
    payload.image = images[0];
    payload.input_reference = images.length === 1 ? images[0] : images;
}

function appendJsonVideoAudioFields(payload: Record<string, unknown>, audios: string[]) {
    if (!audios.length) return;
    payload.audio_url = audios[0];
    if (audios.length > 1) payload.audio_urls = audios;
}

function assertJsonVideoAudioReferences(model: string, images: string[], audioReferences: ReferenceAudio[]) {
    if (!audioReferences.length || !isPixelleJsonVideoModel(model)) return;
    if (!images.length) throw new Error("视频参考音频必须同时连接至少一张参考图");
    const invalidDuration = audioReferences.find((audio) => typeof audio.duration === "number" && (audio.duration <= 2 || audio.duration >= 15));
    if (invalidDuration) throw new Error("视频参考音频时长需要大于 2 秒且小于 15 秒");
}

async function prepareJsonVideoAudioUrls(model: string, audioReferences: ReferenceAudio[]) {
    const limit = getJsonVideoAudioLimit(model);
    if (!limit) return [];
    const audios = audioReferences.slice(0, limit);
    if (!isPixelleJsonVideoModel(model)) return (await Promise.all(audios.map((audio) => audioToDataUrl(audio)))).filter(Boolean);

    return (await Promise.all(audios.map(audioToVideoReferenceUrl))).filter(Boolean);
}

function getJsonVideoReferenceLimit(model: string) {
    if (isGeekNowSoraModel(model) || isSora2VideoModel(model) || isVeo31FastVideoModel(model) || /^kling-video-3\.0$/i.test(model.trim())) return 1;
    if (isPixelleJsonVideoModel(model)) return 9;
    if (/^kling-video-o3-omni$/i.test(model.trim())) return 7;
    return 7;
}

function getJsonVideoAudioLimit(model: string) {
    return isPixelleJsonVideoModel(model) ? 3 : 0;
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    if (size === "1:1") return "1024x1024";
    if (size === "21:9") return "1680x720";
    if (size === "4:3") return "1024x768";
    if (size === "3:4") return "768x1024";
    if (size === "16:9") return "1280x720";
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeSoraVideoSize(value: string, model: string) {
    const size = normalizeVideoSize(value) || "1280x720";
    if (/^sora-2-pro$/i.test(model.trim()) && ["720x1280", "1280x720", "1792x1024", "1024x1792"].includes(size)) return size;
    return size === "720x1280" ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function normalizeVideoResolutionForModel(value: string, model: string) {
    const resolution = normalizeVideoResolution(value);
    if (isSora2VideoModel(model)) return "720p";
    if (isSoraV3VideoModel(model)) return resolution === "480p" ? "480p" : "720p";
    if (isKlingVideoModel(model) || isVeo31FastVideoModel(model)) return resolution === "1080p" ? "1080p" : "720p";
    return resolution;
}

async function imageToVideoReferenceFile(image: ReferenceImage) {
    const dataUrl = await imageToDataUrl(image);
    const optimizedDataUrl = await optimizeVideoReferenceDataUrl(dataUrl);
    return dataUrlToFile({ ...image, name: videoReferenceFileName(image.name), type: "image/jpeg", dataUrl: optimizedDataUrl });
}

async function audioToDataUrl(audio: ReferenceAudio) {
    return mediaToDataUrl(audio);
}

async function audioToVideoReferenceUrl(audio: ReferenceAudio) {
    const directUrl = (audio.url || "").trim();
    if (/^https?:\/\//i.test(directUrl)) return directUrl;

    const dataUrl = await audioToDataUrl(audio);
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
        // 视频上游对音频格式较挑剔，本地上传统一转成 WAV，减少 m4a/webm/ogg 被拒的概率。
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
    // 视频图生图只需要视觉参考，先压到中转站更稳定接受的尺寸，避免 4K 原图触发接口异常。
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
        reader.onerror = () => reject(new Error("视频参考图读取失败"));
        reader.readAsDataURL(blob);
    });
}

function videoReferenceFileName(name?: string) {
    const base = (name || "reference").replace(/\.[^.]+$/, "");
    return `${base || "reference"}.jpg`;
}

function unwrapVideoTask(payload: ApiVideoResponse): NewApiVideoTask {
    if (!payload) throw new Error("接口没有返回视频任务");
    if ("code" in payload && typeof payload.code === "number") {
        if (payload.code !== 0) throw new Error(payload.msg || "请求失败");
        if (!payload.data) throw new Error("接口没有返回视频任务");
        return unwrapVideoTask(payload.data);
    }
    const task = findVideoTask(payload);
    if (!task) throw new Error("接口没有返回视频任务");
    return task;
}

function unwrapNewApiVideoResponse(payload: NewApiVideoResponse): NewApiVideoTask {
    if (!payload) throw new Error("接口没有返回视频任务");
    if ("code" in payload && typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || payload.error?.message || "请求失败");
    const data = "data" in payload ? payload.data : payload;
    const task = findVideoTask(data);
    if (!task) throw new Error("接口没有返回视频任务");
    return task;
}

function findVideoTask(input: unknown): NewApiVideoTask | null {
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
    const nested = findNestedVideoFields(record);
    const id = stringValue(record.id) || stringValue(record.request_id) || stringValue(record.task_id) || stringValue(record.taskId) || nested.id;
    const url = stringValue(record.url) || stringValue(record.video_url) || stringValue(record.videoUrl) || stringValue(record.output_url) || stringValue(record.result_url) || stringValue(record.file_url) || directHttpUrl(record.output) || directHttpUrl(record.fail_reason) || nested.url;
    const status = stringValue(record.status) || stringValue(record.state) || nested.status;
    if (id || url || status) {
        const errorMessage = stringValue((record.error as Record<string, unknown> | undefined)?.message) || stringValue(record.error_message) || stringValue(record.fail_reason);
        return { id, url, videoUrl: stringValue(record.videoUrl), output: record.output, status, error: errorMessage ? { message: errorMessage } : undefined };
    }
    for (const value of Object.values(record)) {
        const task = findVideoTask(value);
        if (task) return task;
    }
    return null;
}

function findNestedVideoFields(input: unknown, depth = 0): { id: string; status: string; url: string } {
    if (depth > 5 || !input) return { id: "", status: "", url: "" };
    if (Array.isArray(input)) {
        for (const item of input) {
            const found = findNestedVideoFields(item, depth + 1);
            if (found.url || found.id || found.status) return found;
        }
        return { id: "", status: "", url: "" };
    }
    if (typeof input !== "object") return { id: "", status: "", url: "" };
    const record = input as Record<string, unknown>;
    const direct = {
        id: stringValue(record.id) || stringValue(record.request_id) || stringValue(record.task_id) || stringValue(record.taskId),
        status: stringValue(record.status) || stringValue(record.state),
        url: stringValue(record.url) || stringValue(record.video_url) || stringValue(record.videoUrl) || stringValue(record.output_url) || stringValue(record.result_url) || stringValue(record.file_url) || directHttpUrl(record.output) || directHttpUrl(record.fail_reason),
    };
    if (direct.url) return direct;
    for (const value of Object.values(record)) {
        const found = findNestedVideoFields(value, depth + 1);
        if (found.url || found.id || found.status) {
            return {
                id: direct.id || found.id,
                status: direct.status || found.status,
                url: direct.url || found.url,
            };
        }
    }
    return direct;
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

function findVideoUrl(input: unknown): string {
    if (!input) return "";
    if (typeof input === "string") {
        const parsed = parseJsonString(input);
        if (parsed) return findVideoUrl(parsed);
        return findVideoUrlInText(input);
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
    const direct = stringValue(record.url) || stringValue(record.video_url) || stringValue(record.videoUrl) || stringValue(record.output_url) || stringValue(record.result_url) || stringValue(record.file_url) || directHttpUrl(record.output) || directHttpUrl(record.fail_reason);
    if (direct) return direct;
    for (const value of Object.values(record)) {
        const url = findVideoUrl(value);
        if (url) return url;
    }
    return "";
}

function directHttpUrl(value: unknown) {
    const text = stringValue(value);
    return /^https?:\/\//i.test(text) ? text : "";
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

function findVideoUrlInText(value: string) {
    const match = value.match(/https?:\/\/[^\s)"'<>]+?\.(?:mp4|webm|mov)(?:\?[^\s)"'<>]+)?/i);
    return match?.[0] || "";
}

function isVideoTaskCompleted(task: NewApiVideoTask) {
    return Boolean(findVideoUrl(task)) || isVideoStatusCompleted(task.status);
}

function isVideoTaskFailed(task: NewApiVideoTask) {
    return isVideoStatusFailed(task.status);
}

function isVideoStatusCompleted(status?: string) {
    return ["completed", "succeeded", "success", "done"].includes((status || "").toLowerCase());
}

function isVideoStatusFailed(status?: string) {
    return ["fail", "failed", "failure", "cancelled", "canceled", "error"].includes((status || "").toLowerCase());
}

function shouldFallbackToTaskVideoApi(error: unknown) {
    return axios.isAxiosError(error) && [404, 405].includes(error.response?.status || 0);
}

function shouldFallbackToNextVideoSource(error: unknown) {
    return shouldFallbackToTaskVideoApi(error) || shouldFallbackToCompatibleVideoApi(error) || (error instanceof Error && /没有返回视频地址/.test(error.message));
}

function shouldFallbackToCompatibleVideoApi(error: unknown) {
    if (!axios.isAxiosError(error) || error.response?.status !== 400) return false;
    const message = extractApiErrorMessage(error.response.data);
    // 上游 token 池不可用不是请求参数错误，继续尝试兼容接口，避免单一路径直接卡死。
    return isCompatibleVideoFallbackMessage(message);
}

function isCompatibleVideoFallbackMessage(message: string) {
    return /no active tokens available|no available tokens?|tokens? unavailable|no available channel|channel unavailable/i.test(message);
}

function isGrokVideosMultipartModel(model: string) {
    return /^grok-video-3(?:-|$)/i.test(model.trim());
}

function isBafangGrokImagineVideo15Model(model: string) {
    return /^grok-imagine-video-1\.5(?:-|$)/i.test(model.trim());
}

function isChatCompletionsFirstModel(model: string) {
    return /^grok-imagine-video(?:-|$)/i.test(model.trim()) && !isBafangGrokImagineVideo15Model(model);
}

function isSora2VideoModel(model: string) {
    return /^sora-?2(?:-|$)/i.test(model.trim());
}

function isGeekNowSoraModel(model: string) {
    return /^sora-2(?:-pro)?$/i.test(model.trim());
}

function isSoraV3VideoModel(model: string) {
    return /^sora-v3(?:-|$)/i.test(model.trim());
}

function isSeedanceVideoModel(model: string) {
    return /^seedance-?2(?:-|$)/i.test(model.trim());
}

function isPixelleJsonVideoModel(model: string) {
    return isSoraV3VideoModel(model) || isSeedanceVideoModel(model);
}

function isSoraVideoModel(model: string) {
    return isSora2VideoModel(model) || isSoraV3VideoModel(model) || /^sora(?:-|$)/i.test(model.trim());
}

function isVeoVideoModel(model: string) {
    return /^(?:veo(?:[_-]|$)|veo31(?:-|$))/i.test(model.trim());
}

function isVeo31FastVideoModel(model: string) {
    return /^veo31-fast$/i.test(model.trim());
}

function isKlingVideoModel(model: string) {
    return /^kling-video(?:-|$)/i.test(model.trim());
}

function isStandardJsonVideoModel(model: string) {
    const normalized = model.trim().toLowerCase();
    return [
        "kling-video-3.0",
        "kling-video-o3-omni",
        "sora2",
        "sora-v3-pro",
        "sora-v3-fast",
        "veo31-fast",
    ].includes(normalized);
}

function isJsonVideosFirstModel(model: string) {
    return isStandardJsonVideoModel(model) || isSoraVideoModel(model) || isSeedanceVideoModel(model) || isVeoVideoModel(model) || isKlingVideoModel(model);
}

function videoDownloadHeaders(config: AiConfig, source: VideoApiSource, url: string) {
    const headers = aiHeaders(config, source);
    if (!headers || !shouldSendVideoDownloadAuth(source, url)) return undefined;
    return headers;
}

function shouldSendVideoDownloadAuth(source: VideoApiSource, url: string) {
    if (url.startsWith("/api/v1/videos/") || url.startsWith("/api-proxy/videos/")) return true;
    if (!/^https?:\/\//i.test(url) || !source.baseUrl) return false;
    try {
        const target = new URL(url);
        const baseCandidates = [source.baseUrl, source.baseUrl.endsWith("/v1") ? source.baseUrl : `${source.baseUrl}/v1`];
        return baseCandidates.some((base) => {
            const apiRoot = new URL(base);
            const rootPath = apiRoot.pathname.replace(/\/+$/, "");
            return target.origin === apiRoot.origin && target.pathname.startsWith(`${rootPath}/videos/`);
        });
    } catch {
        return false;
    }
}

async function fetchVideoUrlAsBlob(url: string, headers?: Record<string, string>) {
    const response = await fetch(url, { cache: "no-store", headers });
    if (!response.ok) throw new Error(`视频 URL 下载失败：HTTP ${response.status}`);
    const blob = await response.blob();
    await assertVideoBlob(blob);
    return blob;
}

// 生成结果优先从原视频接口的 content 端点下载，避免中转站返回的外部直链被浏览器跨域拦截。
async function fetchVideoResultBlob(config: AiConfig, source: VideoApiSource, taskId: string, videoUrl: string) {
    if (taskId) {
        try {
            const content = await axios.get<Blob>(aiApiUrl(config, source, `/videos/${taskId}/content`), { headers: aiHeaders(config, source), responseType: "blob", timeout: requestTimeout(source) });
            await assertVideoBlob(content.data);
            return content.data;
        } catch (error) {
            if (!shouldFallbackToDirectVideoUrl(error)) throw error;
        }
    }
    return fetchVideoUrlAsBlob(videoUrl, videoDownloadHeaders(config, source, videoUrl));
}

function shouldFallbackToDirectVideoUrl(error: unknown) {
    if (!axios.isAxiosError(error)) return true;
    return !error.response || [400, 404, 405].includes(error.response.status || 0);
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
    const direct =
        stringValue(record.msg) ||
        stringValue(record.message) ||
        stringValue(record.detail) ||
        stringValue(record.reason) ||
        stringValue(record.error_message) ||
        stringValue(record.fail_reason);
    if (direct) return direct;
    if (typeof record.error === "string") return record.error.trim();
    return extractApiErrorMessage(record.error) || extractApiErrorMessage(record.data);
}

function buildVideoGenerationError(failures: VideoAttemptError[]) {
    const visibleFailures = failures.filter((failure) => failure.message.trim());
    if (!visibleFailures.length) return new Error("视频生成失败");
    const first = visibleFailures[0];
    const summary = visibleFailures
        .map((failure) => `${failure.label}：${failure.message}`)
        .filter((item, index, array) => array.indexOf(item) === index)
        .join("；");
    return new Error(visibleFailures.length > 1 ? `视频生成失败：${summary}` : `视频生成失败：${first.label}：${first.message}`);
}

function formatVideoSourceLabel(source: VideoApiSource, model: string) {
    const baseUrl = source.baseUrl ? ` ${source.baseUrl}` : "";
    const route = source.baseUrl ? "直连" : source.label === "系统后端" ? "当前站点 /api/v1" : "本地";
    return `${source.label}${baseUrl} [${model}，${route}]`;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "视频下载失败");
}
