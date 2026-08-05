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
});

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
