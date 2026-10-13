import { buildNodeGenerationInputs } from '@/app/(user)/canvas/components/canvas-node-generation';
import type { CanvasConnection, CanvasNodeData } from '@/app/(user)/canvas/types';

// 上游使用节点标记，西米露通过连线读取内容；文本只拼接一次，媒体保留有序引用。
export function resolveAgentPrompt(prompt: string, nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    return prompt.replace(/@\[node:([\w-]+)\]/g, (_marker, id: string) => {
        const node = nodes.find(item => item.id === id);
        if (!node) throw new Error(`引用节点不存在：${id}`);
        if (node.type === 'text') return inputs.some(input => input.nodeId === id) ? '' : node.metadata?.content || node.metadata?.prompt || '';
        const media = inputs.filter(input => input.type === node.type);
        const index = media.findIndex(input => input.nodeId === id);
        if (index < 0) throw new Error(`请先连接参考素材：${node.title}`);
        return `[reference ${node.type} ${index + 1}]`;
    }).trim();
}
