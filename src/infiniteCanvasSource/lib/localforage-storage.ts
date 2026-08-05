import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

function readLocalStorageBackup(name: string) {
    try {
        return window.localStorage.getItem(name);
    } catch {
        return null;
    }
}

function writeLocalStorageBackup(name: string, value: string) {
    try {
        // 画布和素材的结构数据同步写一份到 localStorage，避免 IndexedDB 被浏览器清理后列表直接变空。
        window.localStorage.setItem(name, value);
        return true;
    } catch {
        // localStorage 空间不足时保留 IndexedDB 主存储，不影响用户继续使用。
        return false;
    }
}

function removeLocalStorageBackup(name: string) {
    try {
        window.localStorage.removeItem(name);
    } catch {
        // localStorage 不可用时忽略，和浏览器隐私设置保持兼容。
    }
}

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            return (await localforage.getItem<string>(name)) || readLocalStorageBackup(name);
        } catch {
            return readLocalStorageBackup(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        const backupWritten = writeLocalStorageBackup(name, value);
        try {
            await localforage.setItem(name, value);
        } catch (error) {
            if (!backupWritten) throw error;
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        removeLocalStorageBackup(name);
        try {
            await localforage.removeItem(name);
        } catch {
            removeLocalStorageBackup(name);
        }
    },
};
