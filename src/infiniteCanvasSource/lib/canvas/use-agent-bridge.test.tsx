// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentStore } from '@/stores/use-agent-store';
import { useAgentBridge } from './use-agent-bridge';
import type { CanvasAgentSnapshot } from './canvas-agent-ops';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('Canvas Agent 生成桥接', () => {
    it('提交完整节点和连线后调用现有生成器，保留品质且只生成一次', async () => {
        let snapshot: CanvasAgentSnapshot = { projectId: 'test', title: '测试', nodes: [], connections: [], groups: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
        const events: string[] = [];
        const generate = vi.fn(async (id: string) => {
            events.push('generate');
            expect(snapshot.nodes.find(node => node.id === id)?.metadata).toMatchObject({ quality: 'high', size: '1536x1024', imageBackground: 'transparent' });
            expect(snapshot.connections).toHaveLength(1);
        });
        function Harness() {
            const [, redraw] = useState(0);
            useAgentBridge({ ready: true, snapshot, read: () => snapshot, canUndo: false, undo: vi.fn(), validateGeneration: vi.fn(), generate,
                commit: next => { events.push('commit'); snapshot = next; redraw(value => value + 1); } });
            return null;
        }
        await act(async () => root.render(<Harness />));
        await act(async () => {
            useAgentStore.getState().canvasContext!.applyOps([
                { type: 'add_node', id: 'text', nodeType: 'text', metadata: { content: '创作提示词' } },
                { type: 'add_node', id: 'result', nodeType: 'config', metadata: { generationMode: 'image', quality: 'high', size: '1536x1024', imageBackground: 'transparent' } },
                { type: 'connect_nodes', fromNodeId: 'text', toNodeId: 'result' },
                { type: 'run_generation', nodeId: 'result', mode: 'image', prompt: '@[node:text]' },
            ]);
        });
        expect(events).toEqual(['commit', 'generate']);
        expect(generate).toHaveBeenCalledExactlyOnceWith('result', 'image', '');
        expect(useAgentStore.getState().canvasContext?.snapshot.nodes).toHaveLength(2);
        await act(async () => root.render(null));
        expect(useAgentStore.getState().canvasContext).toBeNull();
    });

    it('缺少生成配置时整批拒绝，不落入假成功或产生空节点', async () => {
        const snapshot: CanvasAgentSnapshot = { projectId: 'test', title: '测试', nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
        const commit = vi.fn();
        const generate = vi.fn();
        function Harness() {
            useAgentBridge({ ready: true, snapshot, read: () => snapshot, canUndo: false, undo: vi.fn(), commit, generate, validateGeneration: () => { throw new Error('请先配置模型'); } });
            return null;
        }
        await act(async () => root.render(<Harness />));
        expect(() => useAgentStore.getState().canvasContext!.applyOps([{ type: 'add_node', id: 'new', nodeType: 'image' }, { type: 'run_generation', nodeId: 'new' }])).toThrow('请先配置模型');
        expect(commit).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
    });
});
