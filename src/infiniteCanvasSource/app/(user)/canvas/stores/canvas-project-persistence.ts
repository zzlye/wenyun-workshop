import { localForageStorage } from "@/lib/localforage-storage";
import { getImageBlob, uploadImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasAssistantReference, type CanvasReferenceImage } from "../types";
import type { CanvasProject } from "./use-canvas-store";

const CANVAS_STORAGE_VERSION = 2;
const INDEX_SUFFIX = ":projects:v2";
const PROJECT_SUFFIX = ":project:v2:";

type CanvasProjectIndexEntry = Pick<CanvasProject, "id" | "title" | "createdAt" | "updatedAt"> & {
    nodeCount: number;
    connectionCount: number;
};

type CanvasProjectIndex = {
    version: typeof CANVAS_STORAGE_VERSION;
    projects: CanvasProjectIndexEntry[];
};

type StoredEmbeddedImage = {
    storageKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
};

const verifiedImageStorageKeys = new Set<string>();

export type LoadedCanvasProjects = {
    projects: CanvasProject[];
    source: "split" | "legacy";
};

export function canvasProjectStorageKey(storeName: string, projectId: string) {
    return `${storeName}${PROJECT_SUFFIX}${projectId}`;
}

export function canvasProjectIndexKey(storeName: string) {
    return `${storeName}${INDEX_SUFFIX}`;
}

export async function loadCanvasProjects(storeName: string): Promise<LoadedCanvasProjects | null> {
    const indexValue = await localForageStorage.getItem(canvasProjectIndexKey(storeName));
    if (indexValue) {
        const index = JSON.parse(indexValue) as CanvasProjectIndex;
        if (index.version !== CANVAS_STORAGE_VERSION || !Array.isArray(index.projects)) throw new Error("画布索引格式错误");

        const projects: CanvasProject[] = [];
        for (const entry of index.projects) {
            const value = await localForageStorage.getItem(canvasProjectStorageKey(storeName, entry.id));
            if (!value) continue;
            projects.push(JSON.parse(value) as CanvasProject);
        }
        return { projects, source: "split" };
    }

    const legacyValue = await localForageStorage.getItem(storeName);
    if (!legacyValue) return null;
    const legacy = JSON.parse(legacyValue) as { state?: { projects?: CanvasProject[] } };
    return { projects: Array.isArray(legacy.state?.projects) ? legacy.state.projects : [], source: "legacy" };
}

export async function persistCanvasProject(storeName: string, project: CanvasProject) {
    const prepared = await prepareCanvasProjectForPersistence(project);
    await localForageStorage.setItem(canvasProjectStorageKey(storeName, project.id), JSON.stringify(prepared));
    return prepared;
}

export async function persistCanvasProjectIndex(storeName: string, projects: CanvasProject[]) {
    const index: CanvasProjectIndex = {
        version: CANVAS_STORAGE_VERSION,
        projects: projects.map((project) => ({
            id: project.id,
            title: project.title,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            nodeCount: project.nodes.length,
            connectionCount: project.connections.length,
        })),
    };
    await localForageStorage.setItem(canvasProjectIndexKey(storeName), JSON.stringify(index));
}

export async function removePersistedCanvasProjects(storeName: string, projectIds: Iterable<string>) {
    for (const projectId of projectIds) {
        await localForageStorage.removeItem(canvasProjectStorageKey(storeName, projectId));
    }
}

export async function removeLegacyCanvasStore(storeName: string) {
    await localForageStorage.removeItem(storeName);
}

export async function removeAllCanvasProjectStorage(storeName: string, projectIds: Iterable<string>) {
    await removePersistedCanvasProjects(storeName, projectIds);
    await localForageStorage.removeItem(canvasProjectIndexKey(storeName));
    await removeLegacyCanvasStore(storeName);
}

export async function prepareCanvasProjectForPersistence(project: CanvasProject): Promise<CanvasProject> {
    const nodes = [];
    for (const node of project.nodes) {
        const metadata = node.metadata;
        if (!metadata) {
            nodes.push(node);
            continue;
        }

        let nextMetadata = { ...metadata };
        if (node.type === CanvasNodeType.Image && (metadata.storageKey || isEmbeddedImageSource(metadata.content))) {
            const stored = await storeEmbeddedImage(metadata.content, metadata.storageKey);
            nextMetadata = {
                ...nextMetadata,
                content: persistedImageSource(metadata.content, stored.storageKey),
                storageKey: stored.storageKey,
                naturalWidth: stored.width ?? metadata.naturalWidth,
                naturalHeight: stored.height ?? metadata.naturalHeight,
                bytes: stored.bytes ?? metadata.bytes,
                mimeType: stored.mimeType || metadata.mimeType,
            };
        }

        if (metadata.referenceImages?.length) {
            const referenceImages: CanvasReferenceImage[] = [];
            for (const reference of metadata.referenceImages) {
                referenceImages.push(await prepareReferenceImage(reference));
            }
            nextMetadata.referenceImages = referenceImages;
        }

        if (metadata.references?.length) {
            const references: string[] = [];
            for (const reference of metadata.references) {
                if (!isEmbeddedImageSource(reference)) {
                    references.push(reference);
                    continue;
                }
                const stored = await storeEmbeddedImage(reference);
                if (stored.storageKey) references.push(stored.storageKey);
            }
            nextMetadata.references = references;
        }

        nodes.push({ ...node, metadata: nextMetadata });
    }

    const chatSessions = [];
    for (const session of project.chatSessions || []) {
        const messages = [];
        for (const message of session.messages) {
            const references = [];
            for (const reference of message.references || []) {
                references.push(await prepareAssistantReference(reference));
            }
            const images = [];
            for (const image of message.images || []) {
                const stored = await storeEmbeddedImage(image.dataUrl, image.storageKey);
                images.push({
                    ...image,
                    dataUrl: persistedImageSource(image.dataUrl, stored.storageKey),
                    storageKey: stored.storageKey,
                });
            }
            messages.push({ ...message, references, images });
        }
        chatSessions.push({ ...session, messages });
    }

    return { ...project, nodes, chatSessions };
}

async function prepareReferenceImage(reference: CanvasReferenceImage): Promise<CanvasReferenceImage> {
    const source = reference.dataUrl || reference.url || "";
    const stored = await storeEmbeddedImage(source, reference.storageKey);
    const mask = await storeEmbeddedImage(reference.maskDataUrl, reference.maskStorageKey);
    return {
        ...reference,
        dataUrl: persistedImageSource(reference.dataUrl, stored.storageKey),
        url: persistedImageSource(reference.url, stored.storageKey),
        storageKey: stored.storageKey,
        maskDataUrl: persistedImageSource(reference.maskDataUrl, mask.storageKey) || undefined,
        maskStorageKey: mask.storageKey,
        width: stored.width ?? reference.width,
        height: stored.height ?? reference.height,
        bytes: stored.bytes ?? reference.bytes,
        mimeType: stored.mimeType || reference.mimeType,
    };
}

async function prepareAssistantReference(reference: CanvasAssistantReference): Promise<CanvasAssistantReference> {
    if (!reference.dataUrl && !reference.storageKey) return reference;
    const stored = await storeEmbeddedImage(reference.dataUrl, reference.storageKey);
    return {
        ...reference,
        dataUrl: persistedImageSource(reference.dataUrl, stored.storageKey) || undefined,
        storageKey: stored.storageKey,
    };
}

async function storeEmbeddedImage(source?: string, storageKey?: string): Promise<StoredEmbeddedImage> {
    if (storageKey) {
        if (!isEmbeddedImageSource(source) || verifiedImageStorageKeys.has(storageKey)) return { storageKey };
        const blob = await getImageBlob(storageKey);
        if (blob) {
            verifiedImageStorageKeys.add(storageKey);
            return { storageKey, bytes: blob.size, mimeType: blob.type || undefined };
        }
    }
    if (!source || !isEmbeddedImageSource(source)) return { storageKey };
    try {
        const image = await uploadImage(source);
        verifiedImageStorageKeys.add(image.storageKey);
        return image;
    } catch (error) {
        // 页面重载后的旧 blob 地址已经失效，它本身很短，保留原值供界面提示替换图片。
        if (source.startsWith("blob:")) return { storageKey };
        throw error;
    }
}

function persistedImageSource(source?: string, storageKey?: string) {
    if (!source) return "";
    // Data URL 和 blob 地址只用于当前页面展示，持久化时由短存储键代替。
    return storageKey && isEmbeddedImageSource(source) ? "" : source;
}

function isEmbeddedImageSource(value?: string) {
    return Boolean(value && (value.startsWith("data:image/") || value.startsWith("blob:")));
}
