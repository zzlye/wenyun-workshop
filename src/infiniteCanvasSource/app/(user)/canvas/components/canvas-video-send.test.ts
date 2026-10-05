import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "../types";
import { buildNodeGenerationContext, mergeNodeReferenceImages } from "./canvas-node-generation";
import { isCanvasNodeGenerationLocked } from "../utils/canvas-generation-running";

// 执行页面实际发送回调，替换网络和存储边界，避免复制一套可能与页面分叉的生成逻辑。
const source = readFileSync(new URL("../[id]/canvas-client-page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("canvas-client-page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback = "";
function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleGenerateNode" && node.initializer && ts.isCallExpression(node.initializer)) {
        callback = node.initializer.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
}
visit(ast);
if (!callback) throw new Error("未找到页面实际发送回调");
const compiled = ts.transpileModule(`const handler = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
class VideoTaskPendingError extends Error {}
const makeNode = (id: string, type: CanvasNodeType, content = ""): CanvasNodeData => ({ id, type, title: id, position: { x: 10, y: 20 }, width: 420, height: 240, metadata: { content, status: "success" } });

function scenario(content: string, type = CanvasNodeType.Video) {
    const selected = makeNode("selected", type, content);
    selected.metadata = { ...selected.metadata, prompt: "旧提示词", videoTaskId: undefined };
    const image = makeNode("image", CanvasNodeType.Image, "https://example.test/reference.png");
    const audio = makeNode("audio", CanvasNodeType.Audio, "https://example.test/music.flac");
    const nodes = { current: [image, audio, selected] };
    const connections = { current: [{ id: "image-link", fromNodeId: "image", toNodeId: "selected" }, { id: "audio-link", fromNodeId: "audio", toNodeId: "selected" }] as CanvasConnection[] };
    const commit = (update: (prev: CanvasNodeData[]) => CanvasNodeData[]) => { nodes.current = update(nodes.current); };
    const running = { current: new Set<string>() };
    let finish!: (url: string) => void;
    let fail!: (error: Error) => void;
    const result = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; });
    const request = vi.fn(async (...args: any[]) => { args[6]({ taskId: "new-task" }); return result; });
    const deps = {
        nodesRef: nodes, connectionsRef: connections, runningNodeIdsRef: running, isCanvasNodeGenerationLocked,
        CanvasNodeType, effectiveConfig: {}, activeProfile: { id: "profile" }, isImageConfigReady: true,
        buildGenerationConfig: () => ({ model: "sd-2.0", size: "16:9", videoSeconds: "15", vquality: "720p" }),
        isCanvasGenerationConfigReady: () => true, openConfigDialog: vi.fn(), buildGenerationTiming: () => ({ generationElapsedMs: 100 }),
        markCanvasNodeRunning: (id: string) => running.current.add(id), clearCanvasNodeRunning: (ids: string[]) => ids.forEach(id => running.current.delete(id)),
        commitGenerationNodes: commit, commitGenerationConnections: (update: (prev: CanvasConnection[]) => CanvasConnection[]) => { connections.current = update(connections.current); },
        hydrateManualReferenceImages: async () => [], buildNodeGenerationContext, mergeNodeReferenceImages,
        formatCanvasPromptForApi: (prompt: string) => prompt, hydrateNodeGenerationContext: async (context: unknown) => context,
        withMergedReferenceImages: (context: unknown) => context, nodeSizeFromRatio: () => ({ width: 420, height: 240 }),
        NODE_DEFAULT_SIZE: { video: { width: 420, height: 240 } }, nanoid: vi.fn(() => "new-node"),
        NODE_STATUS_LOADING: "loading", NODE_STATUS_SUCCESS: "success", NODE_STATUS_ERROR: "error",
        referenceUrl: (image: { dataUrl?: string }) => image.dataUrl,
        getGeneratedNodeTitle: (node: CanvasNodeData) => node.title,
        requestVideoGeneration: request,
        persistCanvasVideoTaskReference: (id: string, task: { taskId: string }) => commit(prev => prev.map(node => node.id === id ? { ...node, metadata: { ...node.metadata, videoTaskId: task.taskId } } : node)),
        uploadMediaFile: async (url: string) => ({ url, width: 1280, height: 720 }),
        fitNodeSize: () => ({ width: 420, height: 240 }), VIDEO_NODE_MAX_WIDTH: 420, VIDEO_NODE_MAX_HEIGHT: 420,
        getGeneratedMediaSizePatch: () => ({}), videoMetadata: (video: { url: string }) => ({ content: video.url, status: "success" }),
        CLEARED_VIDEO_TASK_METADATA: { videoTaskId: undefined }, CLEARED_IMAGE_TASK_METADATA: {}, VideoTaskPendingError,
        message: { error: vi.fn() },
    };
    const send = new Function(...Object.keys(deps), compiled + "\nreturn handler;")(...Object.values(deps)) as (id: string, mode: string, prompt: string) => Promise<void>;
    return { nodes, connections, request, finish, fail, send, selected, deps };
}

describe("视频节点实际发送流程", () => {
    it.each(["", "https://example.test/old.mp4"])("空节点或已有视频均原地提交并原地写回：%s", async content => {
        const s = scenario(content);
        const originalLinks = [...s.connections.current];
        const pending = s.send("selected", "video", "起身看向外面，音乐参考");
        await vi.waitFor(() => expect(s.request).toHaveBeenCalledTimes(1));
        expect(s.nodes.current).toHaveLength(3);
        expect(s.connections.current).toEqual(originalLinks);
        const current = s.nodes.current.find(n => n.id === "selected")!;
        expect(current.metadata).toMatchObject({ status: "loading", videoTaskId: "new-task", content });
        expect(current.position).toEqual(s.selected.position);
        expect([current.width, current.height]).toEqual([420, 240]);
        const args = s.request.mock.calls[0];
        expect(args[2]).toHaveLength(1); expect(args[3]).toHaveLength(1); expect(args[4]).toHaveLength(0);
        await s.send("selected", "video", "重复点击");
        expect(s.request).toHaveBeenCalledTimes(1);
        s.finish("https://example.test/new.mp4"); await pending;
        expect(s.nodes.current).toHaveLength(3);
        expect(s.nodes.current.find(n => n.id === "selected")?.metadata).toMatchObject({ content: "https://example.test/new.mp4", status: "success", videoTaskId: undefined });
        expect(s.deps.message.error).not.toHaveBeenCalled();
    });

    it.each([false, true])("失败或仍在等待均保留当前节点和旧视频：等待=%s", async waiting => {
        const s = scenario("https://example.test/old.mp4");
        const pending = s.send("selected", "video", "新提示词");
        await vi.waitFor(() => expect(s.request).toHaveBeenCalledTimes(1));
        s.fail(waiting ? new VideoTaskPendingError("稍后继续查询") : new Error("上游生成失败"));
        await pending;
        expect(s.nodes.current).toHaveLength(3);
        expect(s.connections.current).toHaveLength(2);
        expect(s.nodes.current.find(n => n.id === "selected")?.metadata).toMatchObject({ content: "https://example.test/old.mp4", status: waiting ? "loading" : "error", videoTaskId: "new-task" });
    });

    it("从非视频节点生成仍创建视频结果节点", async () => {
        const s = scenario("参考文字", CanvasNodeType.Text);
        const pending = s.send("selected", "video", "创建视频");
        await vi.waitFor(() => expect(s.request).toHaveBeenCalledTimes(1));
        expect(s.nodes.current).toHaveLength(4);
        expect(s.connections.current.at(-1)).toMatchObject({ fromNodeId: "selected", toNodeId: "new-node" });
        s.finish("https://example.test/new.mp4"); await pending;
        expect(s.nodes.current.find(n => n.id === "new-node")?.metadata?.content).toBe("https://example.test/new.mp4");
    });
});
