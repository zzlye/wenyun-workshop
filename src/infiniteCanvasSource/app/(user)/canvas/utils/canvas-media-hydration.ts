import { uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { CanvasNodeType, type CanvasNodeData } from "../types";

/** 图片节点只恢复元数据，原图按操作读取，缩略图由可见组件按需申请。 */
export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    const restored = await Promise.all(nodes.map(async (node) => {
        const original = node.metadata;
        if (!original) return node;
        let metadata = original;
        if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && original.storageKey) {
            const content = await resolveMediaUrl(original.storageKey, original.content);
            if (content !== original.content) metadata = { ...metadata, content };
        } else if (node.type === CanvasNodeType.Image && !original.storageKey && original.content?.startsWith("data:image/")) {
            // 兼容尚未迁移的老画布；已有原图存储键的节点不读取图片、不改写引用。
            const image = await uploadImage(original.content);
            metadata = { ...metadata, content: image.url, storageKey: image.storageKey, naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
        }
        // 手动参考图和遮罩也保留存储键，打开面板、编辑或实际生成时再读取。
        return metadata === original ? node : { ...node, metadata };
    }));
    return restored.every((node, index) => node === nodes[index]) ? nodes : restored;
}

/** 后台同步只做一次索引，避免末尾生成节点触发平方级查找。 */
export function hasCanvasGenerationUpdate(nodes: CanvasNodeData[], current: CanvasNodeData[], activeIds: ReadonlySet<string>) {
    const currentById = new Map(current.map((node) => [node.id, node]));
    return nodes.some((node) => activeIds.has(node.id) || node.metadata?.status === "loading" || currentById.get(node.id)?.metadata?.status === "loading");
}
