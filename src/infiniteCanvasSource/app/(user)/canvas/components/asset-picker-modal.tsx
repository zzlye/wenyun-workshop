"use client";

import { useEffect, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Dropdown, Empty, Input, Modal, Pagination, Tabs, Tag } from "antd";
import { AudioLines, Search, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { assetTagOptions, assetTagValues, buildAssetTagPatch, getAssetTag, normalizeAssetTag, type AssetTag } from "@/lib/asset-tags";
import { CanvasNodeType, type CanvasNodeData } from "../types";

export type AssetPickerTab = "canvas" | "my-assets";
export type AssetCategory = AssetTag;

export type InsertAssetPayload = { kind: "text"; content: string; title: string } | { kind: "image"; dataUrl: string; title: string; storageKey?: string } | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number } | { kind: "audio"; url: string; title: string; storageKey?: string; bytes?: number; mimeType?: string; duration?: number };

type Props = {
    open: boolean;
    defaultTab?: AssetPickerTab;
    canvasNodes: CanvasNodeData[];
    onRenameCanvasNode: (nodeId: string, title: string) => void;
    onChangeCanvasNodeCategory: (nodeId: string, category: AssetCategory) => void;
    onDeleteCanvasNode: (nodeId: string) => void;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

const PAGE_SIZE = 8;
const kindOptions = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

export function AssetPickerModal({ open, defaultTab = "my-assets", canvasNodes, onRenameCanvasNode, onChangeCanvasNodeCategory, onDeleteCanvasNode, onInsert, onClose }: Props) {
    const [activeTab, setActiveTab] = useState<AssetPickerTab>(defaultTab);

    useEffect(() => {
        if (open) setActiveTab(defaultTab);
    }, [open, defaultTab]);

    return (
        <Modal title="选择素材" open={open} onCancel={onClose} footer={null} width={900} destroyOnHidden styles={{ body: { padding: "0 24px 24px", minHeight: 500 } }}>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as AssetPickerTab)}
                items={[
                    { key: "canvas", label: "画布", children: <CanvasAssetsTab nodes={canvasNodes} onRename={onRenameCanvasNode} onChangeCategory={onChangeCanvasNodeCategory} onDelete={onDeleteCanvasNode} onInsert={onInsert} /> },
                    { key: "my-assets", label: "我的素材", children: <MyAssetsTab onInsert={onInsert} /> },
                ]}
            />
        </Modal>
    );
}

function CanvasAssetsTab({ nodes, onRename, onChangeCategory, onDelete, onInsert }: { nodes: CanvasNodeData[]; onRename: (nodeId: string, title: string) => void; onChangeCategory: (nodeId: string, category: AssetCategory) => void; onDelete: (nodeId: string) => void; onInsert: (payload: InsertAssetPayload) => void }) {
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [categoryFilter, setCategoryFilter] = useState<"all" | AssetCategory>("all");
    const [page, setPage] = useState(1);

    const assets = useMemo(
        () =>
            nodes
                .filter((node) => node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio)
                .filter((node) => node.type === CanvasNodeType.Text || Boolean(node.metadata?.content)),
        [nodes],
    );

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets
            .filter((node) => kindFilter === "all" || node.type === kindFilter)
            .filter((node) => categoryFilter === "all" || getCanvasNodeAssetCategory(node) === categoryFilter)
            .filter((node) => !query || [node.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query));
    }, [assets, categoryFilter, keyword, kindFilter]);

    const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        setPage((value) => Math.min(value, maxPage));
    }, [filtered.length]);

    const handleInsert = (node: CanvasNodeData) => {
        if (node.type === CanvasNodeType.Text) {
            onInsert({ kind: "text", content: node.metadata?.content || "", title: node.title });
            return;
        }
        if (node.type === CanvasNodeType.Video) {
            onInsert({ kind: "video", url: node.metadata?.content || "", storageKey: node.metadata?.storageKey, title: node.title, width: node.metadata?.naturalWidth || node.width, height: node.metadata?.naturalHeight || node.height });
            return;
        }
        if (node.type === CanvasNodeType.Audio) {
            onInsert({ kind: "audio", url: node.metadata?.content || "", storageKey: node.metadata?.storageKey, title: node.title, bytes: node.metadata?.bytes, mimeType: node.metadata?.mimeType, duration: node.metadata?.duration });
            return;
        }
        onInsert({ kind: "image", dataUrl: node.metadata?.content || "", storageKey: node.metadata?.storageKey, title: node.title });
    };

    return (
        <PickerList
            keyword={keyword}
            kindFilter={kindFilter}
            categoryFilter={categoryFilter}
            total={filtered.length}
            page={page}
            empty="当前画布没有可插入素材"
            onKeywordChange={(value) => {
                setPage(1);
                setKeyword(value);
            }}
            onKindChange={(value) => {
                setPage(1);
                setKindFilter(value);
            }}
            onCategoryChange={(value) => {
                setPage(1);
                setCategoryFilter(value);
            }}
            onPageChange={setPage}
        >
            {visible.map((node) => (
                <CanvasPickerCard key={node.id} node={node} onInsert={() => handleInsert(node)} onRename={(title) => onRename(node.id, title)} onChangeCategory={(category) => onChangeCategory(node.id, category)} onDelete={() => onDelete(node.id)} />
            ))}
        </PickerList>
    );
}

function MyAssetsTab({ onInsert }: { onInsert: (payload: InsertAssetPayload) => void }) {
    const assets = useAssetStore((state) => state.assets);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [categoryFilter, setCategoryFilter] = useState<"all" | AssetCategory>("all");
    const [page, setPage] = useState(1);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets
            .filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video" || asset.kind === "audio")
            .filter((asset) => kindFilter === "all" || asset.kind === kindFilter)
            .filter((asset) => categoryFilter === "all" || getStoredAssetCategory(asset) === categoryFilter)
            .filter((asset) => !query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query));
    }, [assets, categoryFilter, keyword, kindFilter]);

    const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        setPage((value) => Math.min(value, maxPage));
    }, [filtered.length]);

    const handleInsert = (asset: Asset) => {
        if (asset.kind === "text") {
            onInsert({ kind: "text", content: asset.data.content, title: asset.title });
            return;
        }
        if (asset.kind === "video") {
            onInsert({ kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height });
            return;
        }
        if (asset.kind === "audio") {
            onInsert({ kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, bytes: asset.data.bytes, mimeType: asset.data.mimeType, duration: asset.data.duration });
            return;
        }
        onInsert({ kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title });
    };

    return (
        <PickerList
            keyword={keyword}
            kindFilter={kindFilter}
            categoryFilter={categoryFilter}
            total={filtered.length}
            page={page}
            empty="没有素材"
            onKeywordChange={(value) => {
                setPage(1);
                setKeyword(value);
            }}
            onKindChange={(value) => {
                setPage(1);
                setKindFilter(value);
            }}
            onCategoryChange={(value) => {
                setPage(1);
                setCategoryFilter(value);
            }}
            onPageChange={setPage}
        >
            {visible.map((asset) => (
                <StoredPickerCard
                    key={asset.id}
                    asset={asset}
                    onInsert={() => handleInsert(asset)}
                    onRename={(title) => updateAsset(asset.id, { title })}
                    onChangeCategory={(category) => updateAsset(asset.id, buildAssetTagPatch(asset, category))}
                    onDelete={() => removeAsset(asset.id)}
                />
            ))}
        </PickerList>
    );
}

function PickerList({ keyword, kindFilter, categoryFilter, total, page, empty, onKeywordChange, onKindChange, onCategoryChange, onPageChange, children }: { keyword: string; kindFilter: string; categoryFilter: "all" | AssetCategory; total: number; page: number; empty: string; onKeywordChange: (value: string) => void; onKindChange: (value: string) => void; onCategoryChange: (value: "all" | AssetCategory) => void; onPageChange: (page: number) => void; children: ReactNode }) {
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Input className="w-60" size="small" prefix={<Search className="size-3.5 text-stone-400" />} placeholder="搜索素材" value={keyword} allowClear onChange={(event) => onKeywordChange(event.target.value)} />
                <div className="flex gap-1.5">
                    {kindOptions.map((opt) => (
                        <Tag.CheckableTag key={opt.value} checked={kindFilter === opt.value} className={cn("prompt-filter-tag", kindFilter === opt.value && "is-active")} onChange={() => onKindChange(opt.value)}>
                            {opt.label}
                        </Tag.CheckableTag>
                    ))}
                </div>
                <div className="h-5 w-px bg-stone-200 dark:bg-stone-700" />
                <div className="flex gap-1.5">
                    {assetTagOptions.map((opt) => (
                        <Tag.CheckableTag key={opt.value} checked={categoryFilter === opt.value} className={cn("prompt-filter-tag", categoryFilter === opt.value && "is-active")} onChange={() => onCategoryChange(opt.value)}>
                            {opt.label}
                        </Tag.CheckableTag>
                    ))}
                </div>
            </div>

            {total ? <div className="grid grid-cols-4 gap-3">{children}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} className="py-12" />}

            {total > PAGE_SIZE ? (
                <div className="flex justify-center">
                    <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={total} onChange={onPageChange} showSizeChanger={false} />
                </div>
            ) : null}
        </div>
    );
}

function CanvasPickerCard({ node, onInsert, onRename, onChangeCategory, onDelete }: { node: CanvasNodeData; onInsert: () => void; onRename: (title: string) => void; onChangeCategory: (category: AssetCategory) => void; onDelete: () => void }) {
    return <PickerCard title={node.title} kind={node.type} category={getCanvasNodeAssetCategory(node)} cover={node.type === CanvasNodeType.Image ? node.metadata?.content || "" : node.type === CanvasNodeType.Video ? node.metadata?.content || "" : ""} text={node.type === CanvasNodeType.Text ? node.metadata?.content || node.title : ""} onInsert={onInsert} onRename={onRename} onChangeCategory={onChangeCategory} onDelete={onDelete} />;
}

function StoredPickerCard({ asset, onInsert, onRename, onChangeCategory, onDelete }: { asset: Asset; onInsert: () => void; onRename: (title: string) => void; onChangeCategory: (category: AssetCategory) => void; onDelete: () => void }) {
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : asset.kind === "video" ? asset.data.url : "");
    const text = asset.kind === "text" ? asset.data.content : "";
    return <PickerCard title={asset.title} kind={asset.kind} category={getStoredAssetCategory(asset)} cover={cover} text={text} onInsert={onInsert} onRename={onRename} onChangeCategory={onChangeCategory} onDelete={onDelete} />;
}

function PickerCard({ title, kind, category, cover, text, onInsert, onRename, onChangeCategory, onDelete }: { title: string; kind: string; category: AssetCategory; cover: string; text?: string; onInsert: () => void; onRename: (title: string) => void; onChangeCategory: (category: AssetCategory) => void; onDelete: () => void }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(title);
    const [deleteOpen, setDeleteOpen] = useState(false);

    useEffect(() => {
        setDraft(title);
    }, [title]);

    const commitRename = () => {
        const next = draft.trim();
        setEditing(false);
        if (next && next !== title) onRename(next);
        else setDraft(title);
    };

    const confirmDelete = (event: MouseEvent) => {
        event.stopPropagation();
        setDeleteOpen(true);
    };

    return (
        <>
            <div className="group relative overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500">
                <button type="button" className="block w-full cursor-pointer text-left" onClick={onInsert}>
                    {kind === "audio" ? (
                        <AudioPreview title={title} />
                    ) : kind === "video" && cover ? (
                        <video src={cover} className="aspect-[4/3] w-full bg-black object-cover" muted playsInline />
                    ) : cover ? (
                        <img src={cover} alt={title} className="aspect-[4/3] w-full object-cover" />
                    ) : (
                        <TextPreview text={text || title} />
                    )}
                </button>
                <div className="space-y-2 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                        {editing ? (
                            <Input
                                size="small"
                                value={draft}
                                autoFocus
                                onChange={(event) => setDraft(event.target.value)}
                                onBlur={commitRename}
                                onPressEnter={commitRename}
                                onClick={(event) => event.stopPropagation()}
                            />
                        ) : (
                            <button
                                type="button"
                                className="min-w-0 flex-1 cursor-text truncate text-left text-xs font-medium text-stone-800 dark:text-stone-200"
                                onClick={(event) => event.stopPropagation()}
                                onDoubleClick={(event) => {
                                    event.stopPropagation();
                                    setEditing(true);
                                }}
                                title={`${title}，双击重命名`}
                            >
                                {title}
                            </button>
                        )}
                        <Tag className="m-0 shrink-0 text-[10px]">{assetKindLabel(kind)}</Tag>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400">
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: assetTagValues.map((item) => ({ key: item, label: item })),
                                onClick: ({ key }) => onChangeCategory(key as AssetCategory),
                            }}
                        >
                            <button
                                type="button"
                                className="rounded-md bg-stone-100 px-1.5 py-0.5 transition hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700"
                                onClick={(event) => event.stopPropagation()}
                                title="点击修改标签"
                            >
                                {category}
                            </button>
                        </Dropdown>
                        <span>双击名称重命名</span>
                    </div>
                </div>
                <div className="pointer-events-none absolute inset-x-0 top-0 flex aspect-[4/3] items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/45 group-hover:opacity-100">插入</div>
                <button
                    type="button"
                    className="absolute bottom-2 right-2 z-10 grid size-8 translate-y-1 place-items-center rounded-full border border-red-200 bg-white/95 text-red-500 opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100 hover:bg-red-50 dark:border-red-500/40 dark:bg-stone-950/95 dark:hover:bg-red-950/40"
                    onClick={confirmDelete}
                    aria-label="删除素材"
                    title="删除"
                >
                    <Trash2 className="size-4" />
                </button>
            </div>

            <Modal title={null} open={deleteOpen} centered footer={null} onCancel={() => setDeleteOpen(false)} styles={{ body: { padding: 0 } }}>
                <div className="rounded-2xl border border-stone-200 bg-white p-5 text-stone-900 shadow-2xl dark:border-white/[0.08] dark:bg-stone-950 dark:text-stone-100">
                    <h3 className="text-base font-semibold">删除素材？</h3>
                    <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">删除「{title}」后不会再显示在这个素材列表里。</p>
                    <div className="mt-5 flex justify-end gap-2">
                        <button type="button" className="rounded-lg px-4 py-2 text-sm text-stone-600 transition hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/[0.08]" onClick={() => setDeleteOpen(false)}>
                            取消
                        </button>
                        <button
                            type="button"
                            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600"
                            onClick={() => {
                                setDeleteOpen(false);
                                onDelete();
                            }}
                        >
                            删除
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    );
}

function TextPreview({ text }: { text: string }) {
    return (
        <div className="flex aspect-[4/3] w-full overflow-hidden bg-stone-100 p-3 text-xs leading-5 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
            <p className="line-clamp-6 min-w-0 break-words text-left">{text}</p>
        </div>
    );
}

function AudioPreview({ title }: { title: string }) {
    return (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-stone-100 p-4 text-stone-500 dark:bg-stone-800 dark:text-stone-300">
            <span className="grid size-12 place-items-center rounded-full bg-white shadow-sm dark:bg-stone-900">
                <AudioLines className="size-6" />
            </span>
            <span className="line-clamp-2 text-center text-xs">{title}</span>
        </div>
    );
}

function assetKindLabel(kind: string) {
    if (kind === "image") return "图片";
    if (kind === "video") return "视频";
    if (kind === "audio") return "音频";
    return "文本";
}

function getCanvasNodeAssetCategory(node: CanvasNodeData): AssetCategory {
    const value = node.metadata?.assetCategory;
    return normalizeAssetTag(value);
}

function getStoredAssetCategory(asset: Asset): AssetCategory {
    return getAssetTag(asset);
}
