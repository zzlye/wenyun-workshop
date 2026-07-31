"use client";

import React, { useEffect, useState } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasGroupData } from "../types";

type CanvasGroupBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type CanvasGroupFrameProps = {
    group: CanvasGroupData;
    bounds: CanvasGroupBounds;
    selected: boolean;
    onSelect: (groupId: string) => void;
    onDragStart: (event: React.MouseEvent, groupId: string) => void;
    onRename: (groupId: string, title: string) => void;
};

export const CanvasGroupFrame = React.memo(function CanvasGroupFrame({ group, bounds, selected, onSelect, onDragStart, onRename }: CanvasGroupFrameProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(group.title);
    const toolbarBackground = theme.toolbar.panel;
    const toolbarBorder = theme.toolbar.border;
    const toolbarText = theme.node.text;

    useEffect(() => {
        if (!editingTitle) setTitleDraft(group.title);
    }, [editingTitle, group.title]);

    const finishTitleEdit = () => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) onRename(group.id, nextTitle);
        setEditingTitle(false);
    };

    return (
        <>
            <div data-canvas-group-visual-id={group.id} className="pointer-events-none absolute left-0 top-0 z-[5]">
                <div
                    data-canvas-group-id={group.id}
                    className="pointer-events-auto absolute cursor-move rounded-[18px] border-2"
                    style={{
                        left: bounds.x,
                        top: bounds.y,
                        width: bounds.width,
                        height: bounds.height,
                        background: selected ? `${group.color}1a` : `${group.color}10`,
                        borderColor: selected ? group.color : `${group.color}70`,
                        boxShadow: selected ? `0 0 0 1px ${group.color}88, 0 18px 48px rgba(15,23,42,.16)` : `0 12px 34px rgba(15,23,42,.08)`,
                    }}
                    onMouseDown={(event) => {
                        if (event.button !== 0) return;
                        onSelect(group.id);
                        onDragStart(event, group.id);
                    }}
                />
            </div>
            <div data-canvas-group-visual-id={group.id} className="pointer-events-none absolute left-0 top-0 z-[75]">
                <div
                    className="pointer-events-auto absolute flex h-8 max-w-[220px] -translate-y-[calc(100%+8px)] cursor-move items-center"
                    style={{ left: bounds.x + 8, top: bounds.y }}
                >
                    {editingTitle ? (
                        <input
                            data-canvas-editor
                            className="h-8 max-w-[220px] rounded-lg border px-2 text-sm font-semibold outline-none backdrop-blur"
                            style={{ background: `${toolbarBackground}f2`, borderColor: toolbarBorder, color: toolbarText }}
                            value={titleDraft}
                            autoFocus
                            onChange={(event) => setTitleDraft(event.target.value)}
                            onBlur={finishTitleEdit}
                            onFocus={(event) => event.currentTarget.select()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") event.currentTarget.blur();
                                if (event.key === "Escape") {
                                    setTitleDraft(group.title);
                                    setEditingTitle(false);
                                }
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            className="h-8 max-w-[220px] truncate px-1 text-lg font-bold"
                            style={{ color: toolbarText, textShadow: "0 1px 8px rgba(0,0,0,.18)" }}
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                setEditingTitle(true);
                            }}
                            title="双击重命名"
                            onMouseDown={(event) => {
                                onSelect(group.id);
                                onDragStart(event, group.id);
                            }}
                        >
                            {group.title}
                        </button>
                    )}
                </div>

                {selected ? (
                    <>
                        <ResizeHint className="-translate-x-1/2 -translate-y-1/2" style={{ left: bounds.x + bounds.width / 2, top: bounds.y }} color={group.color} />
                        <ResizeHint className="-translate-x-1/2 translate-y-1/2" style={{ left: bounds.x + bounds.width / 2, top: bounds.y + bounds.height }} color={group.color} />
                        <ResizeHint className="-translate-x-1/2 -translate-y-1/2" style={{ left: bounds.x, top: bounds.y + bounds.height / 2 }} color={group.color} vertical />
                        <ResizeHint className="translate-x-1/2 -translate-y-1/2" style={{ left: bounds.x + bounds.width, top: bounds.y + bounds.height / 2 }} color={group.color} vertical />
                    </>
                ) : null}
            </div>
        </>
    );
});

function ResizeHint({ className, style, color, vertical = false }: { className: string; style: React.CSSProperties; color: string; vertical?: boolean }) {
    return <div className={`pointer-events-none absolute z-[65] rounded-full shadow-md ${className} ${vertical ? "h-14 w-2.5" : "h-2.5 w-14"}`} style={{ ...style, background: color }} />;
}
