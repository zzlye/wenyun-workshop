import { getDataUrlByteSize, readImageMeta } from '@/lib/image-utils';
import { imageToDataUrl } from '@/services/image-storage';
import type { CanvasNodeData } from '@/app/(user)/canvas/types';

export type CanvasResourceKind = 'image' | 'video' | 'audio' | 'text';
export type CanvasResourceReference = { id: string; nodeId: string; kind: CanvasResourceKind; label: string; title: string; previewUrl?: string; text?: string; active: boolean };

export function buildCanvasResourceReferences(nodes: CanvasNodeData[]): CanvasResourceReference[] {
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    const labels = { image: '图片', video: '视频', audio: '音频', text: '文本' };
    return nodes.flatMap(node => {
        if (!(node.type in counts)) return [];
        const kind = node.type as CanvasResourceKind;
        const content = node.metadata?.content || (kind === 'text' ? node.metadata?.prompt : '');
        if (!content) return [];
        const label = `${labels[kind]} ${++counts[kind]}`;
        return [{ id: node.id, nodeId: node.id, kind, label, title: node.title || label, previewUrl: kind === 'text' ? undefined : content, text: kind === 'text' ? content : undefined, active: true }];
    });
}

export async function resolveCanvasReferenceImages(references: CanvasResourceReference[], nodes: CanvasNodeData[]) {
    return Promise.all(references.filter(reference => reference.kind === 'image').map(async reference => {
        const node = nodes.find(item => item.id === reference.nodeId);
        if (!node) throw new Error(`图片不存在：${reference.title}`);
        // 浏览器的 blob 地址不能交给本机服务读取，始终从素材存储解析完整图片。
        const dataUrl = await imageToDataUrl({ storageKey: node.metadata?.storageKey, url: node.metadata?.content });
        if (!dataUrl.startsWith('data:image/')) throw new Error(`图片读取失败：${reference.title}`);
        const meta = await readImageMeta(dataUrl);
        return { id: `canvas:${node.id}`, name: reference.title, type: meta.mimeType, size: getDataUrlByteSize(dataUrl), width: meta.width, height: meta.height, url: reference.previewUrl || dataUrl, dataUrl };
    }));
}
