import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/app/(user)/canvas/stores/use-canvas-store';
import { useAssetStore } from '@/stores/use-asset-store';
import { useConfigStore } from '@/stores/use-config-store';
import { useAgentStore } from '@/stores/use-agent-store';
import { fetchPrompts } from '@/services/api/prompts';
import { uploadImage } from '@/services/image-storage';
import type { CanvasAgentOp, CanvasAgentSnapshot } from '@/lib/canvas/canvas-agent-ops';
import type { CanvasNodeMetadata } from '@/app/(user)/canvas/types';

export const SITE_TOOL_NAMES = ['canvas_list_projects', 'generation_get_status', 'workbench_image_get_config', 'workbench_image_generate', 'workbench_video_get_config', 'workbench_video_generate', 'prompts_search', 'assets_list', 'assets_add'] as const;
export type SiteToolName = typeof SITE_TOOL_NAMES[number];
export const SITE_TOOL_LABELS: Record<SiteToolName, string> = { canvas_list_projects: '画布列表', generation_get_status: '生成状态', workbench_image_get_config: '图片配置', workbench_image_generate: '生成图片', workbench_video_get_config: '视频配置', workbench_video_generate: '生成视频', prompts_search: '搜索提示词', assets_list: '素材列表', assets_add: '保存素材' };
export function isSiteTool(name: string): name is SiteToolName { return SITE_TOOL_NAMES.includes(name as SiteToolName); }
type Input = Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
function paginate<T>(items: T[], input: Input) {
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize)) || 20));
    const page = Math.max(1, Math.floor(Number(input.page)) || 1);
    return { total: items.length, page, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

export async function runSiteTool(name: SiteToolName, input: Input, _navigate: (path: string) => void, context: { canvasSnapshot?: CanvasAgentSnapshot | null } = {}): Promise<unknown> {
    const keyword = text(input.keyword).toLowerCase();
    switch (name) {
        case 'canvas_list_projects': {
            const state = useCanvasStore.getState();
            if (!state.hydrated) throw new Error('画布列表正在加载');
            return paginate(state.projects.filter(project => project.title.toLowerCase().includes(keyword)).map(project => ({ id: project.id, title: project.title, createdAt: project.createdAt, updatedAt: project.updatedAt, nodeCount: project.nodes.length, connectionCount: project.connections.length })), input);
        }
        case 'generation_get_status': {
            const snapshot = context.canvasSnapshot || useAgentStore.getState().canvasContext?.snapshot;
            const ids = strings(input.nodeIds);
            const tasks = (snapshot?.nodes || []).filter(node => (!ids.length || ids.includes(node.id)) && (!input.taskId || node.id === input.taskId)).map(node => ({ id: node.id, source: 'canvas', kind: node.metadata?.generationMode || node.type, title: node.title, status: ({ idle: 'idle', loading: 'running', success: 'succeeded', error: 'failed' } as const)[node.metadata?.status || 'idle'], error: node.metadata?.errorDetails })).filter(task => !input.scope || input.scope === 'all' || input.scope === 'canvas' || input.scope === task.kind);
            return { total: tasks.length, tasks: tasks.slice(0, Math.max(1, Math.min(100, Number(input.limit) || 20))) };
        }
        case 'workbench_image_get_config':
        case 'workbench_video_get_config': {
            // 仅返回可见创作参数，不将 API 地址、密钥或任务访问令牌发送给 Agent。
            const config = useConfigStore.getState().config;
            const video = name === 'workbench_video_get_config';
            return { current: { model: video ? config.videoModel : config.imageModel, size: config.size, ...(video ? { seconds: config.videoSeconds, resolution: config.vquality, mode: config.videoMode, generateAudio: config.videoGenerateAudio } : { quality: config.quality, imageBackground: config.imageBackground, count: config.count }) }, models: config.models, destination: 'canvas' };
        }
        case 'workbench_image_generate':
        case 'workbench_video_generate': {
            const canvas = useAgentStore.getState().canvasContext;
            if (!canvas) throw new Error('请先打开画布');
            const mode = name === 'workbench_video_generate' ? 'video' : 'image';
            const prompt = text(input.prompt);
            if (!prompt) throw new Error('提示词不能为空');
            const id = nanoid();
            const metadata: CanvasNodeMetadata = { prompt, generationMode: mode };
            for (const field of ['model', 'quality', 'size', 'seconds', 'imageBackground'] as const) if (text(input[field])) metadata[field] = text(input[field]);
            if (input.count !== undefined) {
                const count = Number(input.count);
                if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('图片数量须为 1 到 10');
                metadata.count = count;
            }
            if (input.resolution) metadata.vquality = text(input.resolution);
            if (typeof input.generateAudio === 'boolean') metadata.videoGenerateAudio = input.generateAudio;
            if (input.mode === 'reference' || input.mode === 'frames') metadata.videoMode = input.mode === 'reference' ? 'references' : 'frames';
            if (typeof input.watermark === 'boolean') metadata.videoExtraParameters = { watermark: input.watermark };
            const right = Math.max(0, ...canvas.snapshot.nodes.map(node => node.position.x + node.width)) + 80;
            const ops: CanvasAgentOp[] = [{ type: 'add_node', id, nodeType: mode, title: prompt.slice(0, 32), position: { x: right, y: 0 }, metadata }];
            if (input.run !== false) ops.push({ type: 'run_generation', nodeId: id, mode, prompt });
            canvas.applyOps(ops);
            return { ok: true, taskId: id, destination: 'canvas', submitted: input.run !== false };
        }
        case 'prompts_search': return fetchPrompts({ keyword, category: text(input.category), tag: strings(input.tags), page: Number(input.page) || 1, pageSize: Math.min(50, Number(input.pageSize) || 20) });
        case 'assets_list': {
            if (!useAssetStore.persist.hasHydrated()) throw new Error('素材正在加载');
            const assets = useAssetStore.getState().assets.filter(asset => (!input.kind || input.kind === 'all' || asset.kind === input.kind) && [asset.title, asset.note, ...asset.tags].join(' ').toLowerCase().includes(keyword));
            return paginate(assets.map(asset => ({ id: asset.id, kind: asset.kind, title: asset.title, tags: asset.tags, note: asset.note, content: asset.kind === 'text' ? asset.data.content : undefined })), input);
        }
        case 'assets_add': {
            if (!useAssetStore.persist.hasHydrated()) throw new Error('素材正在加载');
            const title = text(input.title);
            if (!title) throw new Error('素材名称不能为空');
            const common = { title, tags: strings(input.tags), source: text(input.source) || 'Canvas Agent', note: text(input.note) };
            const store = useAssetStore.getState();
            if (input.kind === 'text') {
                const content = text(input.content);
                if (!content) throw new Error('素材内容不能为空');
                return { ok: true, id: store.addAsset({ ...common, kind: 'text', coverUrl: '', data: { content } }) };
            }
            if (input.kind === 'image') {
                const image = await uploadImage(text(input.imageUrl));
                return { ok: true, id: store.addAsset({ ...common, kind: 'image', coverUrl: image.url, data: { ...image, dataUrl: image.url } }) };
            }
            throw new Error('不支持的素材类型');
        }
    }
}
