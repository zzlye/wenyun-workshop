import { useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useAgentStore } from '@/stores/use-agent-store';
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from './canvas-agent-ops';
import { resolveAgentPrompt } from './canvas-agent-prompt';
import type { CanvasNodeData } from '@/app/(user)/canvas/types';

type GenerationMode = 'text' | 'image' | 'video';
type Bridge = {
    ready: boolean;
    snapshot: CanvasAgentSnapshot;
    read: () => CanvasAgentSnapshot;
    commit: (next: CanvasAgentSnapshot) => void;
    generate: (id: string, mode: GenerationMode, prompt: string) => Promise<void>;
    validateGeneration: (node: CanvasNodeData, mode: GenerationMode) => void;
    undo: () => void;
    canUndo: boolean;
};

export function useAgentBridge(options: Bridge) {
    const current = useRef(options);
    current.current = options;
    const applyOps = useCallback((ops: CanvasAgentOp[] = []) => {
        const bridge = current.current;
        if (!bridge.ready) throw new Error('画布尚未加载完成');
        const next = applyCanvasAgentOps(bridge.read(), ops);
        const generations = ops.filter((op): op is Extract<CanvasAgentOp, { type: 'run_generation' }> => op.type === 'run_generation');
        const ids = new Set<string>();
        const jobs = generations.map(op => {
            if (ids.has(op.nodeId)) throw new Error('同一节点不能重复提交生成');
            ids.add(op.nodeId);
            const node = next.nodes.find(item => item.id === op.nodeId);
            if (!node) throw new Error('生成节点已被删除');
            const mode = (op.mode || node.metadata?.generationMode || (node.type === 'text' ? 'text' : node.type === 'video' ? 'video' : 'image')) as GenerationMode;
            bridge.validateGeneration(node, mode);
            return { id: node.id, mode, prompt: resolveAgentPrompt(op.prompt ?? node.metadata?.prompt ?? '', node.id, next.nodes, next.connections) };
        });
        // 先同步节点、连线与持久化状态，再调用原有生成流程，避免新节点尚未落盘就被任务覆盖。
        flushSync(() => bridge.commit(next));
        for (const job of jobs) void bridge.generate(job.id, job.mode, job.prompt).catch(error => {
            useAgentStore.getState().addMessage({ id: `generation-error-${job.id}-${Date.now()}`, role: 'error', text: error instanceof Error ? error.message : '生成失败' });
        });
        return bridge.read();
    }, []);
    const undoOps = useCallback(() => {
        const bridge = current.current;
        if (bridge.read().nodes.some(node => node.metadata?.status === 'loading')) throw new Error('生成进行中，暂不能撤销画布');
        if (!bridge.canUndo) return null;
        flushSync(bridge.undo);
        return bridge.read();
    }, []);
    useEffect(() => {
        useAgentStore.getState().setCanvasContext(options.ready ? { snapshot: options.snapshot, applyOps, undoOps, canUndo: options.canUndo } : null);
    }, [options.ready, options.snapshot, options.canUndo, applyOps, undoOps]);
    useEffect(() => () => useAgentStore.getState().setCanvasContext(null), []);
}
