export type PreviewRequest = { promise: Promise<string>; release: () => void };

/** 图片显示使用引用计数与并发队列，限制空闲缓存，不回收仍在显示的地址。 */
export function createImagePreviewCache(load: (key: string) => Promise<Blob>, options: { concurrency?: number; idleLimit?: number } = {}) {
    type Entry = { key: string; users: number; url: string; invalid: boolean; done: boolean; promise: Promise<string>; resolve: (url: string) => void; reject: (error: unknown) => void };
    const entries = new Map<string, Entry>();
    const queue: Entry[] = [];
    const concurrency = options.concurrency ?? 2;
    const idleLimit = options.idleLimit ?? 24;
    let active = 0;
    const revoke = (entry: Entry) => {
        if (entry.url) URL.revokeObjectURL(entry.url);
        entry.url = "";
    };

    const trim = () => {
        const idle = [...entries.values()].filter((entry) => entry.done && entry.users === 0);
        for (const entry of idle.slice(0, Math.max(0, idle.length - idleLimit))) {
            revoke(entry);
            entries.delete(entry.key);
        }
    };
    const pump = () => {
        while (active < concurrency && queue.length) {
            const entry = queue.shift()!;
            if (!entry.users) {
                if (entries.get(entry.key) === entry) entries.delete(entry.key);
                entry.done = true;
                entry.resolve("");
                continue;
            }
            active++;
            void load(entry.key).then((blob) => {
                entry.url = URL.createObjectURL(blob);
                entry.done = true;
                entry.resolve(entry.url);
            }).catch((error) => {
                if (entries.get(entry.key) === entry) entries.delete(entry.key);
                entry.done = true;
                entry.reject(error);
            }).finally(() => {
                active--;
                if (entry.invalid && !entry.users) revoke(entry);
                trim();
                pump();
            });
        }
    };
    return {
        request(key: string, priority = false): PreviewRequest {
            let entry = entries.get(key);
            if (!entry) {
                let resolve!: Entry["resolve"];
                let reject!: Entry["reject"];
                const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
                entry = { key, users: 0, url: "", invalid: false, done: false, promise, resolve, reject };
                entries.set(key, entry);
                if (priority) queue.unshift(entry);
                else queue.push(entry);
            }
            // 重新访问的空闲图片排在末尾，优先回收更早离开视口的图片。
            entries.delete(key);
            entries.set(key, entry);
            entry.users++;
            pump();
            let released = false;
            return { promise: entry.promise, release: () => {
                if (released) return;
                released = true;
                entry!.users--;
                if (entry!.invalid && !entry!.users) revoke(entry!);
                trim();
            } };
        },
        invalidate(matches: (key: string) => boolean) {
            for (const [key, entry] of entries) {
                if (!matches(key)) continue;
                entries.delete(key);
                entry.invalid = true;
                if (!entry.users) revoke(entry);
            }
        },
    };
}
