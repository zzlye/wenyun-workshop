import localforage from "localforage";
import { getImageBlob } from "./image-storage";
import { createImagePreviewCache } from "./image-preview-cache";

const thumbnails = localforage.createInstance({ name: "infinite-canvas", storeName: "image_previews_v1" });
const revisions = new Map<string, number>();
const cache = createImagePreviewCache(async (key) => {
    const { storageKey, source, size, revision } = JSON.parse(key) as { storageKey?: string; source: string; size: number; revision: number };
    // 派生缓存独立保存；原图被导入覆盖时会失效此缓存，不影响生成、导出和裁剪的数据源。
    const diskKey = storageKey ? `${storageKey}:${size}` : "";
    if (diskKey) {
        const saved = await thumbnails.getItem<Blob>(diskKey).catch(() => null);
        if (saved) return saved;
    }
    let blob = storageKey ? await getImageBlob(storageKey) : null;
    if (!blob && source) {
        const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("图片预览读取失败");
        blob = await response.blob();
    }
    if (!blob) throw new Error("图片不存在");
    const preview = await resizePreview(blob, size);
    // 派生缓存写入失败不影响当前预览，避免空间不足时连原图也无法展示。
    if (diskKey && revision === (revisions.get(storageKey!) || 0)) await thumbnails.setItem(diskKey, preview).catch(() => undefined);
    return preview;
});

export function requestImagePreview(storageKey?: string, source = "", compact = false) {
    // 当前放大或选中节点优先于全览的小图，不等待整张画布的预览队列。
    return cache.request(JSON.stringify({ storageKey, source, size: compact ? 128 : 512, revision: storageKey ? revisions.get(storageKey) || 0 : 0 }), !compact);
}

async function resizePreview(blob: Blob, maxSize: number): Promise<Blob> {
    let image: ImageBitmap | HTMLImageElement;
    let url = "";
    if (typeof createImageBitmap === "function") {
        image = await createImageBitmap(blob);
    } else {
        url = URL.createObjectURL(blob);
        try {
            image = await new Promise<HTMLImageElement>((resolve, reject) => {
                const element = new Image();
                element.onload = () => resolve(element);
                element.onerror = () => reject(new Error("图片预览解码失败"));
                element.src = url;
            });
        } catch (error) { URL.revokeObjectURL(url); throw error; }
    }
    try {
        const width = "naturalWidth" in image ? image.naturalWidth : image.width;
        const height = "naturalHeight" in image ? image.naturalHeight : image.height;
        const ratio = Math.min(1, maxSize / Math.max(width, height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("图片预览初始化失败");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob((output) => output ? resolve(output) : reject(new Error("图片预览编码失败")), "image/webp", 0.82));
    } finally {
        if ("close" in image) image.close();
        if (url) URL.revokeObjectURL(url);
    }
}

/** 只清理派生图片；原始媒体仍沿用原有素材清理规则。 */
export async function deleteImagePreviews(keys: Iterable<string>) {
    const removed = new Set(keys);
    for (const key of removed) revisions.set(key, (revisions.get(key) || 0) + 1);
    cache.invalidate((key) => removed.has(JSON.parse(key).storageKey));
    await Promise.all(Array.from(removed).flatMap((key) => [128, 512].map((size) => thumbnails.removeItem(`${key}:${size}`))));
}
