// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasNode } from "./canvas-node";
import { CanvasNodeType, type CanvasNodeData } from "../types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
afterEach(() => {
    if (root) act(() => root.unmount());
    host?.remove();
    vi.restoreAllMocks();
});

async function renderNode(type = CanvasNodeType.Image, content = "data:image/png;base64,fixture") {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onResize = vi.fn();
    const node: CanvasNodeData = { id: "node", title: "测试节点", type, position: { x: 20, y: 30 }, width: 240, height: 360, metadata: { content, naturalWidth: 200, naturalHeight: 300 } };
    const props = { data: node, scale: 0.5, isSelected: true, isRelated: false, isFocusRelated: false, isConnectionTarget: false, isConnecting: false, showPanel: false, showImageInfo: false, onMouseDown: vi.fn(), onHoverStart: vi.fn(), onHoverEnd: vi.fn(), onConnectStart: vi.fn(), onResize, onContentChange: vi.fn(), onContextMenu: vi.fn() };
    await act(async () => root.render(<CanvasNode {...props} />));
    return { onResize, props };
}

function mouse(type: string, x: number, y: number, target: EventTarget = window) {
    act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, buttons: type === "mouseup" ? 0 : 1, clientX: x, clientY: y })); });
}
function startResize() {
    const handle = host.querySelector('[class*="cursor-nwse-resize"][class*="-bottom-"]')!;
    mouse("mousedown", 100, 100, handle);
}

describe("节点缩放与媒体切换", () => {
    it("连续拖拽只在松手提交一次最终尺寸，并保留原始媒体分辨率", async () => {
        const { onResize, props } = await renderNode();
        startResize();
        for (let offset = 1; offset <= 60; offset++) mouse("mousemove", 100 + offset, 100 + offset);
        expect(onResize).not.toHaveBeenCalled();
        mouse("mouseup", 160, 160);
        expect(onResize).toHaveBeenCalledTimes(1);
        expect(onResize).toHaveBeenLastCalledWith("node", 360, 540, { x: 20, y: 30 });
        expect(props.data.metadata?.naturalWidth).toBe(200);
        mouse("mousemove", 200, 200);
        expect(onResize).toHaveBeenCalledTimes(1);
    });

    it("窗口失焦结束缩放，重新移入时不继续改变尺寸", async () => {
        const { onResize } = await renderNode();
        startResize();
        mouse("mousemove", 130, 130);
        act(() => window.dispatchEvent(new Event("blur")));
        expect(onResize).toHaveBeenCalledTimes(1);
        mouse("mousemove", 170, 170);
        expect(onResize).toHaveBeenCalledTimes(1);
    });

    it("按下再松手但未移动时不写回节点", async () => {
        const { onResize } = await renderNode();
        startResize();
        mouse("mouseup", 100, 100);
        expect(onResize).not.toHaveBeenCalled();
    });

    it.each([
        [0, -20, -20, { x: -20, y: -30 }],
        [1, 20, -20, { x: 20, y: -30 }],
        [2, -20, 20, { x: -20, y: 30 }],
        [3, 20, 20, { x: 20, y: 30 }],
    ] as const)("第 %i 个角缩放时固定对角位置", async (index, dx, dy, position) => {
        const { onResize } = await renderNode();
        const handle = host.querySelectorAll('[class*="resize"]')[index];
        mouse("mousedown", 100, 100, handle);
        mouse("mousemove", 100 + dx, 100 + dy);
        mouse("mouseup", 100 + dx, 100 + dy);
        expect(onResize).toHaveBeenLastCalledWith("node", 280, 420, position);
    });

    it("自由比例允许宽高独立变化，缩小不越过最小尺寸", async () => {
        const { onResize, props } = await renderNode();
        await act(async () => root.render(<CanvasNode {...props} data={{ ...props.data, metadata: { ...props.data.metadata, freeResize: true } }} />));
        startResize();
        mouse("mousemove", 120, 110);
        mouse("mouseup", 120, 110);
        expect(onResize).toHaveBeenLastCalledWith("node", 280, 380, { x: 20, y: 30 });
        startResize();
        mouse("mousemove", -1000, -1000);
        mouse("mouseup", -1000, -1000);
        expect(onResize).toHaveBeenLastCalledWith("node", 220, 160, { x: 20, y: 30 });
    });

    it("外部重新渲染不丢失当前拖拽，取消后停止更新", async () => {
        const { onResize, props } = await renderNode();
        const preview = vi.fn();
        await act(async () => root.render(<CanvasNode {...props} onResizePreview={preview} />));
        startResize();
        mouse("mousemove", 120, 120);
        await act(async () => root.render(<CanvasNode {...props} scale={1} onResizePreview={preview} data={{ ...props.data, title: "外部更新" }} />));
        expect(host.querySelector<HTMLElement>('[data-node-id]')?.style.width).toBe("280px");
        expect(preview).toHaveBeenLastCalledWith("node", 280, 420, { x: 20, y: 30 });
        mouse("mousemove", 130, 130);
        act(() => window.dispatchEvent(new Event("pointercancel")));
        expect(onResize).toHaveBeenLastCalledWith("node", 300, 450, { x: 20, y: 30 });
        mouse("mousemove", 150, 150);
        expect(onResize).toHaveBeenCalledTimes(1);
    });

    it.each([CanvasNodeType.Video, CanvasNodeType.Audio])("%s 在空节点和媒体节点之间切换时保持 Hook 顺序", async (type) => {
        const { props } = await renderNode(type, "");
        await act(async () => root.render(<CanvasNode {...props} data={{ ...props.data, metadata: { content: "https://example.test/media" } }} />));
        expect(host.querySelector(type === CanvasNodeType.Video ? "video" : "audio")).not.toBeNull();
        await act(async () => root.render(<CanvasNode {...props} />));
        expect(host.querySelector(type === CanvasNodeType.Video ? "video" : "audio")).toBeNull();
    });
});
