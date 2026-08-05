"use client";

import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();
const BASE64_DECODE_CHUNK_CHARS = 32 * 1024;

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await fetchImageBlob(input) : input;
    const storageKey = `image:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const directUrl = image.dataUrl || image.url || "";
    if (directUrl.startsWith("data:")) return directUrl;

    if (image.storageKey) {
        const storedBlob = await store.getItem<Blob>(image.storageKey);
        if (storedBlob) return blobToDataUrl(storedBlob);
    }

    if (!directUrl) return "";
    const url = await resolveImageUrl(image.storageKey, directUrl);
    if (!url || url.startsWith("data:")) return url;
    try {
        return blobToDataUrl(await fetchImageBlob(url));
    } catch (error) {
        if (!image.storageKey) throw error;
        const storedBlob = await store.getItem<Blob>(image.storageKey);
        if (storedBlob) return blobToDataUrl(storedBlob);
        throw error;
    }
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    if ("maskStorageKey" in value && typeof value.maskStorageKey === "string" && value.maskStorageKey.startsWith("image:")) keys.add(value.maskStorageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

async function fetchImageBlob(url: string) {
    if (url.startsWith("data:")) {
        return dataUrlToBlob(url);
    }
    try {
        return await (await fetch(url)).blob();
    } catch {
        // blob 预览地址可能会在页面重载或缓存恢复后失效，给用户一个可操作的错误。
        throw new Error("图片读取失败，请重新上传或替换这张图片后重试");
    }
}

function dataUrlToBlob(dataUrl: string) {
    const separatorIndex = dataUrl.indexOf(",");
    if (!dataUrl.startsWith("data:") || separatorIndex < 0) {
        throw new Error("图片数据格式错误，请重新生成或上传图片后重试");
    }

    const metadata = dataUrl.slice(5, separatorIndex);
    const content = dataUrl.slice(separatorIndex + 1);
    const metadataParts = metadata.split(";");
    const mimeType = metadataParts[0] || "application/octet-stream";
    const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");
    if (!isBase64) {
        try {
            return new Blob([decodeURIComponent(content)], { type: mimeType });
        } catch {
            throw new Error("图片数据格式错误，请重新生成或上传图片后重试");
        }
    }

    const chunks: ArrayBuffer[] = [];
    try {
        // 分块解码可避免浏览器把二十多 MB 的 Data URL 当网络地址读取，也降低单次临时内存峰值。
        for (let offset = 0; offset < content.length; offset += BASE64_DECODE_CHUNK_CHARS) {
            const binary = atob(content.slice(offset, offset + BASE64_DECODE_CHUNK_CHARS));
            const buffer = new ArrayBuffer(binary.length);
            const bytes = new Uint8Array(buffer);
            for (let index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
            }
            chunks.push(buffer);
        }
    } catch {
        throw new Error("图片数据格式错误，请重新生成或上传图片后重试");
    }
    return new Blob(chunks, { type: mimeType });
}
