import { nanoid } from 'nanoid';
import i18n from '@/i18n';
import { resolveAgentPrompt } from './canvas-agent-prompt';
import { getNodeSpec } from '@/app/(user)/canvas/constants';
import { CanvasNodeType, type CanvasConnection, type CanvasGroupData, type CanvasNodeData, type CanvasNodeMetadata, type ViewportTransform } from '@/app/(user)/canvas/types';

export type CanvasAgentOp =
    | { type: 'add_node'; id?: string; nodeType?: `${CanvasNodeType}`; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: 'update_node'; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: 'delete_node'; id?: string; ids?: string[]; nodeType?: `${CanvasNodeType}` }
    | { type: 'delete_connections'; id?: string; ids?: string[]; all?: boolean }
    | { type: 'connect_nodes'; id?: string; fromNodeId: string; toNodeId: string }
    | { type: 'set_viewport'; viewport: ViewportTransform }
    | { type: 'select_nodes'; ids: string[] }
    | { type: 'run_generation'; nodeId: string; mode?: 'text' | 'image' | 'video' | 'audio'; prompt?: string };

export type CanvasAgentSnapshot = { projectId: string; title: string; nodes: CanvasNodeData[]; connections: CanvasConnection[]; groups?: CanvasGroupData[]; selectedNodeIds: string[]; viewport: ViewportTransform };

export function summarizeCanvasAgentOps(ops: CanvasAgentOp[] = []) {
    const counts: Record<string, number> = {};
    for (const op of ops) counts[op.type] = (counts[op.type] || 0) + 1;
    return Object.entries(counts).map(([type, count]) => `${i18n.t(`canvas.agentOps.${type}`, { defaultValue: type })} ${count}`).join('，');
}

function finite(value: number, label: string, positive = false) {
    if (!Number.isFinite(value) || (positive && value <= 0)) throw new Error(`${label}无效`);
    return value;
}

// Agent 只能修改创作参数，不能伪造任务凭证、运行状态和存储归属。
function editableMetadata(value?: CanvasNodeMetadata): CanvasNodeMetadata {
    const result = { ...value };
    for (const key of Object.keys(result)) {
        if (/api.?key|token|secret|password|authorization|imageTask|videoTask|generationStartedAt|generationElapsedMs/i.test(key)) delete (result as Record<string, unknown>)[key];
    }
    if (result.status === 'loading') throw new Error('运行状态必须由生成流程设置');
    return result;
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops: CanvasAgentOp[] = []): CanvasAgentSnapshot {
    if (!Array.isArray(ops) || ops.length > 200) throw new Error('单次画布操作数量无效');
    let { nodes, connections, selectedNodeIds, viewport } = snapshot;
    const requireNode = (id: string) => {
        const node = nodes.find(item => item.id === id);
        if (!node) throw new Error(`节点不存在：${id}`);
        return node;
    };
    const requireIdle = (id: string) => {
        const node = requireNode(id);
        if (node.metadata?.status === 'loading') throw new Error(`节点正在生成：${node.title}`);
        return node;
    };
    // 先在内存完成整批校验，发生错误时不写入任何一部分。
    for (const op of ops) {
        switch (op.type) {
            case 'add_node': {
                const metadata = editableMetadata(op.metadata);
                // 上游的配置节点在西米露中直接对应可生成的媒体或文字节点。
                const type = (op.nodeType === 'config' ? metadata.generationMode || 'image' : op.nodeType || 'text') as CanvasNodeType;
                if (![CanvasNodeType.Image, CanvasNodeType.Text, CanvasNodeType.Video, CanvasNodeType.Audio].includes(type)) throw new Error('不支持的节点类型');
                const spec = getNodeSpec(type);
                const id = op.id || nanoid();
                if (nodes.some(node => node.id === id)) throw new Error(`节点 ID 重复：${id}`);
                const position = op.position || { x: op.x ?? 0, y: op.y ?? 0 };
                const node = { id, type, title: op.title || spec.title, position: { x: finite(position.x, '横坐标'), y: finite(position.y, '纵坐标') }, width: finite(op.width ?? spec.width, '宽度', true), height: finite(op.height ?? spec.height, '高度', true), metadata: { ...spec.metadata, ...metadata } };
                nodes = [...nodes, node];
                selectedNodeIds = [id];
                break;
            }
            case 'update_node': {
                const node = requireIdle(op.id);
                const patch = op.patch || {};
                if ((patch.id && patch.id !== node.id) || (patch.type && patch.type !== node.type)) throw new Error('不能修改节点 ID 或类型');
                const position = patch.position || node.position;
                const updated = { ...node, title: patch.title ?? node.title, position: { x: finite(position.x, '横坐标'), y: finite(position.y, '纵坐标') }, width: finite(patch.width ?? node.width, '宽度', true), height: finite(patch.height ?? node.height, '高度', true), metadata: { ...node.metadata, ...editableMetadata(patch.metadata), ...editableMetadata(op.metadata) } };
                nodes = nodes.map(item => item.id === op.id ? updated : item);
                break;
            }
            case 'delete_node': {
                const ids = new Set(op.ids || (op.id ? [op.id] : nodes.filter(node => node.type === op.nodeType).map(node => node.id)));
                for (const node of nodes) if (node.metadata?.batchRootId && ids.has(node.metadata.batchRootId)) ids.add(node.id);
                ids.forEach(requireIdle);
                nodes = nodes.filter(node => !ids.has(node.id));
                nodes = nodes.map(node => node.metadata?.batchChildIds?.some(id => ids.has(id)) ? { ...node, metadata: { ...node.metadata, batchChildIds: node.metadata.batchChildIds.filter(id => !ids.has(id)) } } : node);
                connections = connections.filter(item => !ids.has(item.fromNodeId) && !ids.has(item.toNodeId));
                selectedNodeIds = selectedNodeIds.filter(id => !ids.has(id));
                break;
            }
            case 'connect_nodes': {
                requireNode(op.fromNodeId); requireIdle(op.toNodeId);
                if (op.fromNodeId === op.toNodeId) throw new Error('节点不能连接自身');
                if (connections.some(item => item.fromNodeId === op.fromNodeId && item.toNodeId === op.toNodeId)) break;
                if (op.id && connections.some(item => item.id === op.id)) throw new Error('连线 ID 重复');
                connections = [...connections, { id: op.id || nanoid(), fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }];
                break;
            }
            case 'delete_connections': {
                const ids = new Set(op.ids || (op.id ? [op.id] : []));
                connections.filter(item => op.all || ids.has(item.id)).forEach(item => requireIdle(item.toNodeId));
                connections = op.all ? [] : connections.filter(item => !ids.has(item.id));
                break;
            }
            case 'set_viewport':
                viewport = { x: finite(op.viewport.x, '视口横坐标'), y: finite(op.viewport.y, '视口纵坐标'), k: finite(op.viewport.k, '缩放', true) };
                if (viewport.k < 0.05 || viewport.k > 5) throw new Error('缩放范围为 0.05 到 5');
                break;
            case 'select_nodes':
                op.ids.forEach(requireNode); selectedNodeIds = [...new Set(op.ids)]; break;
            case 'run_generation': {
                const node = requireIdle(op.nodeId);
                if (op.mode === 'audio' || node.type === CanvasNodeType.Audio) throw new Error('当前支持图片、视频和文本生成，音频可作为素材引用');
                break;
            }
            default: throw new Error('不支持的画布操作');
        }
    }
    if (nodes.some(node => node.metadata?.prompt?.includes('@[node:'))) nodes = nodes.map(node => node.metadata?.prompt?.includes('@[node:') ? { ...node, metadata: { ...node.metadata, prompt: resolveAgentPrompt(node.metadata.prompt, node.id, nodes, connections) } } : node);
    const ids = new Set(nodes.map(node => node.id));
    const groups = snapshot.groups?.some(group => group.nodeIds.some(id => !ids.has(id))) ? snapshot.groups.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => ids.has(id)) })).filter(group => group.nodeIds.length) : snapshot.groups;
    return { ...snapshot, nodes, connections, groups, selectedNodeIds, viewport };
}
