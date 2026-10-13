import { describe, expect, it } from 'vitest';
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from './canvas-agent-ops';
import { resolveAgentPrompt } from './canvas-agent-prompt';
import { agentSnapshotJson } from '@/lib/agent/agent-serialization';
import { CanvasNodeType } from '@/app/(user)/canvas/types';
import { buildNodeGenerationContext } from '@/app/(user)/canvas/components/canvas-node-generation';

const empty = (): CanvasAgentSnapshot => ({ projectId: 'project', title: '测试画布', nodes: [], connections: [], groups: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } });

describe('Canvas Agent 西米露适配', () => {
    it('将上游生成流程转换为普通图片节点，保持品质、透明背景与引用顺序', () => {
        const snapshot = applyCanvasAgentOps(empty(), [
            { type: 'add_node', id: 'prompt', nodeType: 'text', metadata: { content: '保留构图，调整光照' } },
            { type: 'add_node', id: 'ref', nodeType: 'image', metadata: { content: 'https://example.test/reference.png', storageKey: 'image:ref', mimeType: 'image/png' } },
            { type: 'add_node', id: 'result', nodeType: 'config', metadata: { generationMode: 'image', prompt: '@[node:prompt]\n@[node:ref]', quality: 'high', imageBackground: 'transparent', size: '1536x1024', count: 2, model: 'configured-model' } },
            { type: 'connect_nodes', fromNodeId: 'prompt', toNodeId: 'result' },
            { type: 'connect_nodes', fromNodeId: 'ref', toNodeId: 'result' },
            { type: 'run_generation', nodeId: 'result', mode: 'image' },
        ]);
        const node = snapshot.nodes.find(item => item.id === 'result')!;
        expect(node.type).toBe(CanvasNodeType.Image);
        expect(node.metadata).toMatchObject({ model: 'configured-model', quality: 'high', imageBackground: 'transparent', size: '1536x1024', count: 2 });
        const prompt = resolveAgentPrompt('@[node:prompt]\n@[node:ref]', node.id, snapshot.nodes, snapshot.connections);
        const context = buildNodeGenerationContext(node.id, snapshot.nodes, snapshot.connections, prompt);
        expect(context.prompt).toBe('[reference image 1]\n\n保留构图，调整光照');
        expect(context.referenceImages).toHaveLength(1);
        expect(context.referenceImages[0]).toMatchObject({ storageKey: 'image:ref' });
    });

    it('删除节点时清理连线、分组和选区，并保留撤销前的原始快照', () => {
        const before = applyCanvasAgentOps(empty(), [{ type: 'add_node', id: 'a' }, { type: 'add_node', id: 'b' }, { type: 'connect_nodes', fromNodeId: 'a', toNodeId: 'b' }]);
        before.groups = [{ id: 'g', title: '组', nodeIds: ['a', 'b'], color: 'blue', layout: 'free', padding: 20 }];
        const after = applyCanvasAgentOps(before, [{ type: 'delete_node', id: 'b' }]);
        expect(after.nodes.map(node => node.id)).toEqual(['a']);
        expect(after.connections).toEqual([]);
        expect(after.selectedNodeIds).toEqual([]);
        expect(after.groups?.[0].nodeIds).toEqual(['a']);
        expect(before.nodes).toHaveLength(2);
        expect(before.groups[0].nodeIds).toEqual(['a', 'b']);
    });

    it('无效操作整批拒绝，不能产生重复 ID 或悬空连线', () => {
        const before = empty();
        expect(() => applyCanvasAgentOps(before, [{ type: 'add_node', id: 'a' }, { type: 'connect_nodes', fromNodeId: 'a', toNodeId: 'missing' }])).toThrow('不存在');
        expect(before.nodes).toEqual([]);
        expect(() => applyCanvasAgentOps(before, [{ type: 'add_node', id: 'a' }, { type: 'add_node', id: 'a' }])).toThrow('重复');
        expect(() => applyCanvasAgentOps(before, [{ type: 'set_viewport', viewport: { x: 0, y: 0, k: NaN } }])).toThrow('无效');
        expect(() => applyCanvasAgentOps(before, [{ type: 'add_node', width: -1 }])).toThrow('无效');
    });

    it('运行中的节点不能修改、删除或再次生成', () => {
        const before = applyCanvasAgentOps(empty(), [{ type: 'add_node', id: 'busy', nodeType: 'image' }]);
        before.nodes[0].metadata!.status = 'loading';
        expect(() => applyCanvasAgentOps(before, [{ type: 'delete_node', id: 'busy' }])).toThrow('正在生成');
        expect(() => applyCanvasAgentOps(before, [{ type: 'update_node', id: 'busy', metadata: { quality: 'low' } }])).toThrow('正在生成');
        expect(() => applyCanvasAgentOps(before, [{ type: 'run_generation', nodeId: 'busy' }])).toThrow('正在生成');
    });

    it('快照不发送任务访问令牌及内嵌媒体，创作参数仍保留', () => {
        const wire = JSON.parse(agentSnapshotJson({ metadata: { imageTaskAccessToken: 'sensitive', storageKey: 'internal', quality: 'high', content: 'data:image/png;base64,big', referenceImages: [{ dataUrl: 'data:image/png;base64,big' }] } }));
        expect(wire.metadata).toEqual({ quality: 'high', content: '[媒体数据]', referenceImages: [{ dataUrl: '[媒体数据]' }] });
    });

    it('选择与视口操作不复制节点及分组，避免产生空撤销记录', () => {
        const before = applyCanvasAgentOps(empty(), [{ type: 'add_node', id: 'a' }]);
        const after = applyCanvasAgentOps(before, [{ type: 'select_nodes', ids: ['a'] }, { type: 'set_viewport', viewport: { x: 10, y: 20, k: 2 } }]);
        expect(after.nodes).toBe(before.nodes);
        expect(after.groups).toBe(before.groups);
    });
});
