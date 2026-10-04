import localforage from "localforage";
import { getImageBlob } from "./image-storage";
import { createImagePreviewCache } from "./image-preview-cache";

// 仅用于清理旧版128/512像素缩略图；显示路径不再读取或写入有损缓存。
const legacyThumbnails = localforage.createInstance({ name: "infinite-canvas", storeName: "image_previews_v1" });
const revisions = new Map<string, number>();
const cache = createImagePreviewCache(async (key) => {
    const { storageKey, source } = JSON.parse(key) as { storageKey?: string; source: string };
    let blob = storageKey ? await getImageBlob(storageKey) : null;
    if (!blob && source) {
        const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("图片读取失败");
        blob = await response.blob();
    }
    if (!blob) throw new Error("图片不存在");
    // 直接显示原始字节，保留分辨率、透明通道及原始格式，不经过画布缩放或重新编码。
    return blob;
}, { idleLimit: 4 });

export function requestImagePreview(storageKey?: string, source = "", compact = false) {
    // 全览与放大复用同一份原图；compact只控制队列优先级，不改变清晰度。
    // 离开视口的请求仍会释放，少量空闲缓存用于往返平移，避免保留整张画布的原图。
    return cache.request(JSON.stringify({ storageKey, source, revision: storageKey ? revisions.get(storageKey) || 0 : 0 }), !compact);
}

/** 覆盖或删除图片时失效显示缓存，并清理旧版派生图片，不改写原始素材。 */
export async function deleteImagePreviews(keys: Iterable<string>) {
    const removed = new Set(keys);
    for (const key of removed) revisions.set(key, (revisions.get(key) || 0) + 1);
    cache.invalidate((key) => removed.has(JSON.parse(key).storageKey));
    await Promise.all(Array.from(removed).flatMap((key) => [128, 512].map((size) => legacyThumbnails.removeItem(`${key}:${size}`))));
}
