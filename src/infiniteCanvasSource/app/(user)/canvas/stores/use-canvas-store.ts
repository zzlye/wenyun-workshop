import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasGroupData, CanvasNodeData, ViewportTransform } from "../types";
import {
    loadCanvasProjects,
    persistCanvasProject,
    persistCanvasProjectIndex,
    removeAllCanvasProjectStorage,
    removeLegacyCanvasStore,
    removePersistedCanvasProjects,
} from "./canvas-project-persistence";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    groups?: CanvasGroupData[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    persistenceError: string | null;
    projects: CanvasProject[];
    clearPersistenceError: () => void;
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "groups" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistName = CANVAS_STORE_KEY;
let queuedProjects: CanvasProject[] | null = null;
let latestProjects: CanvasProject[] = [];
let persistChain: Promise<void> = Promise.resolve();
let persistedProjectIds = new Set<string>();
const persistedProjectRefs = new Map<string, CanvasProject>();
let setPersistenceError: (message: string | null) => void = () => undefined;
let pendingPersistenceError: string | null = null;

function reportPersistenceError(message: string | null) {
    pendingPersistenceError = message;
    setPersistenceError(message);
}

async function persistCanvasProjectsSnapshot(name: string, projects: CanvasProject[]) {
    const nextIds = new Set(projects.map((project) => project.id));
    for (const project of projects) {
        if (persistedProjectRefs.get(project.id) === project) continue;
        await persistCanvasProject(name, project);
        persistedProjectRefs.set(project.id, project);
    }

    const removedIds = [...persistedProjectIds].filter((id) => !nextIds.has(id));
    await removePersistedCanvasProjects(name, removedIds);
    removedIds.forEach((id) => persistedProjectRefs.delete(id));
    await persistCanvasProjectIndex(name, projects);
    await removeLegacyCanvasStore(name);
    persistedProjectIds = nextIds;
}

async function flushQueuedCanvasStore() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    const projects = queuedProjects;
    if (!projects) {
        await persistChain;
        return;
    }
    const name = queuedPersistName;
    queuedProjects = null;
    const operation = persistChain.catch(() => undefined).then(() => persistCanvasProjectsSnapshot(name, projects));
    persistChain = operation;
    try {
        await operation;
        reportPersistenceError(null);
    } catch (error) {
        // 保存失败时保留最新快照，下一次编辑或手动刷新保存会继续重试。
        if (!queuedProjects) queuedProjects = projects;
        const details = error instanceof Error ? error.message : String(error);
        reportPersistenceError(`画布自动保存失败：${details || "浏览器存储异常"}`);
        throw error;
    }
}

// 图片任务提交前强制保存画布状态，避免用户立即刷新时丢失幂等键。
export async function flushCanvasStorePersistence() {
    do {
        await flushQueuedCanvasStore();
    } while (queuedProjects);
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const loaded = await loadCanvasProjects(name);
        if (!loaded) return null;

        let projects = loaded.projects;
        let splitStorageReady = loaded.source === "split";
        if (loaded.source === "legacy") {
            try {
                const migrated: CanvasProject[] = [];
                // 旧版数据逐画布、逐图片迁移，避免多张 4K 图同时解码造成新的内存峰值。
                for (let index = 0; index < projects.length; index += 1) {
                    const migratedProject = await persistCanvasProject(name, projects[index]);
                    migrated.push(migratedProject);
                    // 当前画布迁移完成后立即释放旧 Base64 引用，降低多画布迁移时的内存占用。
                    projects[index] = migratedProject;
                }
                projects = migrated;
                await persistCanvasProjectIndex(name, projects);
                await removeLegacyCanvasStore(name);
                splitStorageReady = true;
            } catch (error) {
                const details = error instanceof Error ? error.message : String(error);
                reportPersistenceError(`旧画布迁移失败，原数据已保留：${details || "浏览器存储异常"}`);
                queuedProjects = projects;
            }
        }

        latestProjects = projects;
        persistedProjectIds = splitStorageReady ? new Set(projects.map((project) => project.id)) : new Set();
        persistedProjectRefs.clear();
        if (splitStorageReady) projects.forEach((project) => persistedProjectRefs.set(project.id, project));
        return { state: { projects } as StorageValue<CanvasStore>["state"] };
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (latestProjects === nextState.projects) return;
        latestProjects = nextState.projects;
        queuedPersistName = name;
        queuedProjects = nextState.projects;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            void flushQueuedCanvasStore().catch(() => undefined);
        }, 400);
    },
    removeItem: async (name) => {
        await persistChain.catch(() => undefined);
        const ids = new Set([...persistedProjectIds, ...latestProjects.map((project) => project.id)]);
        await removeAllCanvasProjectStorage(name, ids);
        persistedProjectIds.clear();
        persistedProjectRefs.clear();
        latestProjects = [];
        queuedProjects = null;
    },
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            persistenceError: null,
            projects: [],
            clearPersistenceError: () => {
                pendingPersistenceError = null;
                set({ persistenceError: null });
            },
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    groups: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    groups: source.groups || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                if (error) {
                    const details = error instanceof Error ? error.message : String(error);
                    reportPersistenceError(`画布读取失败：${details || "浏览器存储异常"}`);
                }
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);

setPersistenceError = (persistenceError) => {
    if (useCanvasStore.getState().persistenceError === persistenceError) return;
    useCanvasStore.setState({ persistenceError });
};
if (pendingPersistenceError) setPersistenceError(pendingPersistenceError);
