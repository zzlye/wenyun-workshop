import type { CanvasNodeData } from "../types";

const LOADING_STATUS = "loading";
const INTERRUPTED_ERROR = "页面刷新后前端连接已断开，后台可能已提交请求，无法自动取回本次结果。请确认结果或余额后再重试。";
const activeGenerationIdsByProject = new Map<string, Set<string>>();

// 同时读取内存运行集合和节点持久状态，避免切换节点面板后重复提交生成任务。
export function isCanvasNodeGenerationLocked(node: Pick<CanvasNodeData, "id" | "metadata"> | null | undefined, runningNodeIds: ReadonlySet<string>) {
    if (!node) return false;
    const status = node.metadata?.status;
    if (status === LOADING_STATUS) return true;
    // 页面切换回来后，本地 running 集合可能滞后于后台请求完成结果；成功或失败节点不能继续被旧集合锁住。
    return runningNodeIds.has(node.id) && status !== "success" && status !== "error";
}

export function withRunningCanvasNode(runningNodeIds: ReadonlySet<string>, nodeId: string) {
    const next = new Set(runningNodeIds);
    next.add(nodeId);
    return next;
}

export function withoutRunningCanvasNodes(runningNodeIds: ReadonlySet<string>, nodeIds: Iterable<string>) {
    const next = new Set(runningNodeIds);
    for (const nodeId of nodeIds) next.delete(nodeId);
    return next;
}

export function markCanvasGenerationSession(projectId: string, nodeId: string) {
    const current = activeGenerationIdsByProject.get(projectId) || new Set<string>();
    current.add(nodeId);
    activeGenerationIdsByProject.set(projectId, current);
}

export function clearCanvasGenerationSession(projectId: string, nodeIds: Iterable<string>) {
    const current = activeGenerationIdsByProject.get(projectId);
    if (!current) return;
    for (const nodeId of nodeIds) current.delete(nodeId);
    if (current.size) activeGenerationIdsByProject.set(projectId, current);
    else activeGenerationIdsByProject.delete(projectId);
}

export function getCanvasGenerationSessionIds(projectId: string) {
    return new Set(activeGenerationIdsByProject.get(projectId) || []);
}

export function hasRecoverableCanvasImageTask(node: Pick<CanvasNodeData, "metadata"> | null | undefined) {
    const metadata = node?.metadata;
    // 只要任务指纹和幂等键已经保存，就能用同一个键重新认领服务端任务；服务端会复用已有任务，避免重复生成。
    return Boolean(metadata?.imageTaskIdempotencyKey && metadata.imageTaskRequestFingerprint);
}

export function resetInterruptedCanvasGenerations(nodes: CanvasNodeData[], activeNodeIds: ReadonlySet<string>) {
    return nodes.map((node) => {
        if (node.metadata?.status !== LOADING_STATUS || activeNodeIds.has(node.id)) return node;
        if (hasRecoverableCanvasImageTask(node)) return node;
        // 真正刷新会清空会话级运行集合，这时 loading 节点才需要改成可重试的错误态。
        return { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: INTERRUPTED_ERROR } };
    });
}
