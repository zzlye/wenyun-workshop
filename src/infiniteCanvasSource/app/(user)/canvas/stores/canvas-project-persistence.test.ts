import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());
const storageMocks = vi.hoisted(() => ({
    getItem: vi.fn(async (name: string) => storage.get(name) || null),
    setItem: vi.fn(async (name: string, value: string) => {
        storage.set(name, value);
    }),
    removeItem: vi.fn(async (name: string) => {
        storage.delete(name);
    }),
}));
const uploadImageMock = vi.hoisted(() => vi.fn());
const getImageBlobMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/localforage-storage", () => ({ localForageStorage: storageMocks }));
vi.mock("@/services/image-storage", () => ({ getImageBlob: getImageBlobMock, uploadImage: uploadImageMock }));

import { CanvasNodeType } from "../types";
import {
    canvasProjectIndexKey,
    canvasProjectStorageKey,
    canvasProjectViewportKey,
    loadCanvasProjects,
    persistCanvasProject,
    persistCanvasProjectIndex,
    prepareCanvasProjectForPersistence,
} from "./canvas-project-persistence";
import type { CanvasProject } from "./use-canvas-store";

const STORE_NAME = "infinite-canvas:canvas_store";

describe("canvas project persistence", () => {
    beforeEach(() => {
        storage.clear();
        vi.clearAllMocks();
        getImageBlobMock.mockResolvedValue(new Blob([new Uint8Array([1])], { type: "image/png" }));
        let index = 0;
        uploadImageMock.mockImplementation(async () => {
            index += 1;
            return {
                url: `blob:image-${index}`,
                storageKey: `image:${index}`,
                width: 3840,
                height: 2160,
                bytes: 16 * 1024 * 1024,
                mimeType: "image/png",
            };
        });
    });

    it("把节点图、参考图、遮罩和助手图片移出项目 JSON", async () => {
        const project = createProject("project-large");
        project.nodes = [
            {
                id: "image-node",
                type: CanvasNodeType.Image,
                title: "生成图片",
                position: { x: 0, y: 0 },
                width: 480,
                height: 320,
                metadata: { content: "data:image/png;base64,node-image" },
            },
            {
                id: "config-node",
                type: CanvasNodeType.Config,
                title: "图片配置",
                position: { x: 500, y: 0 },
                width: 320,
                height: 240,
                metadata: {
                    references: ["data:image/png;base64,retry-image"],
                    referenceImages: [
                        {
                            id: "reference-1",
                            name: "参考图",
                            type: "image/png",
                            dataUrl: "data:image/png;base64,reference-image",
                            maskDataUrl: "data:image/png;base64,mask-image",
                            isMaskTarget: true,
                        },
                    ],
                },
            },
        ];
        project.chatSessions = [
            {
                id: "chat-1",
                title: "助手",
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                messages: [
                    {
                        id: "message-1",
                        role: "user",
                        mode: "image",
                        text: "参考这张图",
                        references: [{ id: "assistant-reference", type: CanvasNodeType.Image, title: "参考", dataUrl: "data:image/png;base64,assistant-reference" }],
                    },
                    {
                        id: "message-2",
                        role: "assistant",
                        mode: "image",
                        text: "已生成",
                        images: [{ id: "assistant-image", prompt: "测试", dataUrl: "data:image/png;base64,assistant-image" }],
                    },
                ],
            },
        ];

        const prepared = await prepareCanvasProjectForPersistence(project);
        const serialized = JSON.stringify(prepared);

        expect(serialized).not.toContain("data:image/");
        expect(prepared.nodes[0].metadata).toMatchObject({ content: "", storageKey: "image:1" });
        expect(prepared.nodes[1].metadata?.references).toEqual(["image:4"]);
        expect(prepared.nodes[1].metadata?.referenceImages?.[0]).toMatchObject({ dataUrl: "", storageKey: "image:2", maskDataUrl: undefined, maskStorageKey: "image:3" });
        expect(prepared.chatSessions[0].messages[0].references?.[0]).toMatchObject({ dataUrl: undefined, storageKey: "image:5" });
        expect(prepared.chatSessions[0].messages[1].images?.[0]).toMatchObject({ dataUrl: "", storageKey: "image:6" });
        expect(project.nodes[0].metadata?.content).toContain("data:image/");
    });

    it("已有存储键的图片不会在自动保存时重复写入", async () => {
        const project = createProject("project-existing");
        project.nodes = [
            {
                id: "image-node",
                type: CanvasNodeType.Image,
                title: "生成图片",
                position: { x: 0, y: 0 },
                width: 480,
                height: 320,
                metadata: { content: "blob:preview", storageKey: "image:existing" },
            },
        ];

        const prepared = await prepareCanvasProjectForPersistence(project);

        expect(uploadImageMock).not.toHaveBeenCalled();
        expect(prepared.nodes[0].metadata).toMatchObject({ content: "", storageKey: "image:existing" });
    });

    it("每个画布独立保存，项目索引不包含节点和图片内容", async () => {
        const first = createProject("project-1");
        const second = createProject("project-2");
        first.nodes[0] = {
            id: "image-node",
            type: CanvasNodeType.Image,
            title: "图片",
            position: { x: 0, y: 0 },
            width: 480,
            height: 320,
            metadata: { content: "data:image/png;base64,large-image" },
        };

        await persistCanvasProject(STORE_NAME, first);
        await persistCanvasProject(STORE_NAME, second);
        await persistCanvasProjectIndex(STORE_NAME, [first, second]);

        const indexValue = storage.get(canvasProjectIndexKey(STORE_NAME)) || "";
        expect(indexValue).not.toContain("nodes");
        expect(indexValue).not.toContain("data:image/");
        expect(storage.get(canvasProjectStorageKey(STORE_NAME, first.id))).not.toContain("data:image/");
        expect(storage.has(canvasProjectStorageKey(STORE_NAME, second.id))).toBe(true);

        const loaded = await loadCanvasProjects(STORE_NAME);
        expect(loaded?.source).toBe("split");
        expect(loaded?.projects.map((project) => project.id)).toEqual([first.id, second.id]);
    });

    it("只有视口变化时写轻量记录，刷新能恢复且内容改动使旧视口失效", async () => {
        const project = createProject("viewport-project");
        await persistCanvasProject(STORE_NAME, project);
        await persistCanvasProjectIndex(STORE_NAME, [project]);
        const original = storage.get(canvasProjectStorageKey(STORE_NAME, project.id));
        storageMocks.setItem.mockClear();
        const moved = { ...project, viewport: {x:120,y:80,k:0.2} };
        await persistCanvasProject(STORE_NAME, moved);
        expect(storage.get(canvasProjectStorageKey(STORE_NAME, project.id))).toBe(original);
        expect(storageMocks.setItem).toHaveBeenCalledTimes(1);
        expect(storageMocks.setItem.mock.calls[0][0]).toBe(canvasProjectViewportKey(STORE_NAME, project.id));
        expect(storageMocks.setItem.mock.calls[0][1]).not.toContain('"nodes"');
        expect((await loadCanvasProjects(STORE_NAME))?.projects[0].viewport).toEqual(moved.viewport);
        const stale = storage.get(canvasProjectViewportKey(STORE_NAME, project.id))!;
        const changed = { ...project, nodes: [...project.nodes] };
        await persistCanvasProject(STORE_NAME, changed);
        storage.set(canvasProjectViewportKey(STORE_NAME, project.id), stale);
        expect((await loadCanvasProjects(STORE_NAME))?.projects[0].viewport).toEqual(project.viewport);
    });

    it("视口写入失败保留已保存内容，重试后能恢复", async () => {
        const project = createProject("viewport-retry");
        await persistCanvasProject(STORE_NAME, project);
        await persistCanvasProjectIndex(STORE_NAME, [project]);
        storageMocks.setItem.mockRejectedValueOnce(new Error("存储满"));
        const moved = {...project, viewport:{x:10,y:20,k:0.5}};
        await expect(persistCanvasProject(STORE_NAME, moved)).rejects.toThrow("存储满");
        await persistCanvasProject(STORE_NAME, moved);
        expect((await loadCanvasProjects(STORE_NAME))?.projects[0].viewport).toEqual(moved.viewport);
    });
});

describe("旧生成配置节点迁移", () => {
    beforeEach(() => { storage.clear(); vi.clearAllMocks(); });

    const cases = (["legacy", "split"] as const).flatMap((source) =>
        (["image", "text", "video", undefined] as const).map((mode) => ({ source, mode })),
    );
    it.each(cases)("$source 存储中的 $mode 配置节点恢复成普通节点并保留素材和任务", async ({ source, mode }) => {
        const project = legacyProject("retire-" + source + "-" + mode, mode);
        if (source === "legacy") storage.set(STORE_NAME, JSON.stringify({ state: { projects: [project] } }));
        else {
            storage.set(canvasProjectIndexKey(STORE_NAME), JSON.stringify({ version: 2, projects: [{ id: project.id }] }));
            storage.set(canvasProjectStorageKey(STORE_NAME, project.id), JSON.stringify(project));
        }
        const loaded = (await loadCanvasProjects(STORE_NAME))!.projects[0];
        const targetType = mode === "text" ? CanvasNodeType.Text : mode === "video" ? CanvasNodeType.Video : CanvasNodeType.Image;
        expect(loaded.nodes[0].type).toBe(targetType);
        expect(loaded.nodes[0].title).not.toBe("生成配置");
        expect(loaded.nodes[0]).toMatchObject({ id: "config", position: { x: 80, y: 40 }, width: 340, height: 240,
            metadata: { prompt: "保留提示词", model: "saved-model", count: 3, inputOrder: ["ref"], status: "idle", videoGenerateAudio: false } });
        expect(loaded.nodes[0].metadata?.content).toBe(mode === "text" ? "保留提示词" : "");
        expect(loaded.nodes.slice(1)).toEqual(project.nodes.slice(1));
        expect(loaded.connections).toEqual([{ ...project.connections[0], toSide: "left" }, project.connections[1]]);
        expect(loaded.groups).toEqual(project.groups);
        // 读取迁移不直接覆盖旧记录，保存完成前原数据仍可恢复。
        const key = source === "legacy" ? STORE_NAME : canvasProjectStorageKey(STORE_NAME, project.id);
        expect(storage.get(key)).toContain('"type":"config"');
    });

    it("保存、再次加载和视口更新不会复活旧节点或改变自定义标题", async () => {
        const project = legacyProject("retire-save", "image");
        project.nodes[0].title = "我的构图";
        const saved = await persistCanvasProject(STORE_NAME, project);
        expect(saved.nodes[0]).toMatchObject({ type: CanvasNodeType.Image, title: "我的构图" });
        await persistCanvasProjectIndex(STORE_NAME, [project]);
        const moved = { ...saved, viewport: { x: 10, y: 20, k: 0.5 } };
        await persistCanvasProject(STORE_NAME, moved);
        const loaded = (await loadCanvasProjects(STORE_NAME))!.projects[0];
        expect(loaded.nodes[0].type).toBe(CanvasNodeType.Image);
        expect(loaded.nodes[1].metadata?.videoTaskId).toBe("existing-video-task");
        expect(loaded.viewport).toEqual(moved.viewport);
    });

    it.each(["image", "video"] as const)("旧节点自己的 %s 任务保留原 ID 和加载状态", async (mode) => {
        const project = legacyProject("own-task-" + mode, mode);
        Object.assign(project.nodes[0].metadata!, mode === "image"
            ? { imageTaskId: "old-image-task", imageTaskAccessToken: "local-fixture", imageTaskIdempotencyKey: "old-request" }
            : { videoTaskId: "old-video-task" });
        storage.set(STORE_NAME, JSON.stringify({ state: { projects: [project] } }));
        const metadata = (await loadCanvasProjects(STORE_NAME))!.projects[0].nodes[0].metadata!;
        expect(metadata.status).toBe("loading");
        expect(metadata.imageTaskId || metadata.videoTaskId).toBe("old-" + mode + "-task");
        if (mode === "image") expect(metadata.imageTaskIdempotencyKey).toBe("old-request");
    });

    it("导入和更新旧画布均进入统一迁移，旧对象本身不被改写", async () => {
        const { useCanvasStore, flushCanvasStorePersistence } = await import("./use-canvas-store");
        await useCanvasStore.persist.rehydrate();
        const source = legacyProject("retire-import", "video");
        const original = structuredClone(source);
        const id = useCanvasStore.getState().importProject(source);
        expect(useCanvasStore.getState().openProject(id)?.nodes[0].type).toBe(CanvasNodeType.Video);
        useCanvasStore.getState().updateProject(id, { nodes: original.nodes, connections: original.connections });
        expect(useCanvasStore.getState().openProject(id)?.nodes[0].type).toBe(CanvasNodeType.Video);
        expect(source).toEqual(original);
        await flushCanvasStorePersistence();
        expect((await loadCanvasProjects(STORE_NAME))!.projects.find((project) => project.id === id)?.nodes[0].type).toBe(CanvasNodeType.Video);
    });
});

function legacyProject(id: string, mode?: "image" | "text" | "video"): CanvasProject {
    return { ...createProject(id), nodes: [
        { id: "config", type: CanvasNodeType.Config, title: "生成配置", position: { x: 80, y: 40 }, width: 340, height: 240,
          metadata: { generationMode: mode, prompt: "保留提示词", content: "", model: "saved-model", count: 3, inputOrder: ["ref"], status: "loading", videoGenerateAudio: false } },
        { id: "result", type: CanvasNodeType.Video, title: "视频生成", position: { x: 500, y: 40 }, width: 420, height: 236,
          metadata: { videoTaskId: "existing-video-task", status: "loading", prompt: "实际任务提示词" } },
        { id: "ref", type: CanvasNodeType.Image, title: "原参考图", position: { x: -300, y: 40 }, width: 340, height: 240, metadata: { content: "https://example.test/ref.png" } },
    ], connections: [
        { id: "input", fromNodeId: "ref", toNodeId: "config" },
        { id: "output", fromNodeId: "config", toNodeId: "result", fromSide: "right", toSide: "left" },
    ], groups: [{ id: "group", title: "作品", nodeIds: ["config", "result"], color: "blue", layout: "free", padding: 20 }] };
}

function createProject(id: string): CanvasProject {
    const now = "2026-08-06T00:00:00.000Z";
    return {
        id,
        title: id,
        createdAt: now,
        updatedAt: now,
        nodes: [],
        connections: [],
        groups: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
}
