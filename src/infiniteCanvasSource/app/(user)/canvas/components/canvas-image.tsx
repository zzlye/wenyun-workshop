import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { requestImagePreview } from "@/services/image-preview";
import { resolveImageUrl } from "@/services/image-storage";
import type { CanvasNodeData } from "../types";

/** 画布内只申请轻量预览，卸载或切换图片时释放租约；旧异步结果不覆盖新图。 */
export function CanvasImage({ storageKey, src = "", compact = false, ...props }: ImgHTMLAttributes<HTMLImageElement> & { storageKey?: string; compact?: boolean }) {
    const identity = JSON.stringify([storageKey, src, compact]);
    const [loaded, setLoaded] = useState({ identity: "", url: "" });
    useEffect(() => {
        if (!storageKey && !src) return;
        let cancelled = false;
        const request = requestImagePreview(storageKey, src, compact);
        void request.promise.then((url) => { if (!cancelled) setLoaded({ identity, url }); }).catch(() => {
            // 浏览器不支持缩略图或跨域失败时，仍保留显示原图的兼容路径，不改变节点数据。
            if (cancelled) return;
            void resolveImageUrl(storageKey, src).then((url) => { if (!cancelled) setLoaded({ identity, url }); }).catch(() => undefined);
        });
        return () => { cancelled = true; request.release(); };
    }, [identity, storageKey, src, compact]);
    const url = loaded.identity === identity ? loaded.url : "";
    return <img {...props} src={url || undefined} decoding="async" draggable={false} />;
}

/** 裁剪和原图预览才解析原始媒体，解析结果仅供当前弹层使用。 */
export function useOriginalImageNode(node: CanvasNodeData | null): CanvasNodeData | null {
    const storageKey = node?.metadata?.storageKey;
    const content = node?.metadata?.content || "";
    const [loaded, setLoaded] = useState({ storageKey: "", content: "", url: "" });
    useEffect(() => {
        if (!storageKey) return;
        let cancelled = false;
        void resolveImageUrl(storageKey, content).then((url) => { if (!cancelled) setLoaded({ storageKey, content, url }); }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [storageKey, content]);
    if (!node || !storageKey) return node;
    const url = loaded.storageKey === storageKey && loaded.content === content ? loaded.url : "";
    return { ...node, metadata: { ...node.metadata, content: url } };
}
