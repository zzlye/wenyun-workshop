// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasNode } from "./canvas-node";
import { CanvasImage } from "./canvas-image";
import { hydrateCanvasImages } from "../utils/canvas-media-hydration";
import { CanvasNodeType, type CanvasNodeData } from "../types";

vi.mock("./canvas-image", () => ({ CanvasImage: vi.fn(({storageKey, compact, ...props}) => <img {...props} data-preview-key={storageKey} />) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const noop = () => undefined;
const fixed = { isSelected:false,isRelated:false,isFocusRelated:false,isConnectionTarget:false,isConnecting:false,showPanel:false,showImageInfo:false,
    onMouseDown:noop,onHoverStart:noop,onHoverEnd:noop,onConnectStart:noop,onResize:noop,onContentChange:noop,onContextMenu:noop };
const host = document.createElement("div");
let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => root?.unmount()); host.replaceChildren(); vi.clearAllMocks(); });

describe("大画布组件性能回归", () => {
    it("300 图片节点在全览时简化为 600 个元素，选中节点仍可缩放和连线", async () => {
        root = createRoot(host);
        const nodes: CanvasNodeData[] = Array.from({length:300}, (_,i) => ({id:String(i),title:"图片",type:CanvasNodeType.Image,position:{x:i*300,y:0},width:280,height:200,metadata:{content:"",storageKey:`image:${i}`}}));
        const render = (items: CanvasNodeData[], scale: number, selected = "") => items.map(node => <CanvasNode key={node.id} {...fixed} data={node} scale={scale} isSelected={selected===node.id} />);
        await act(async () => root.render(render(nodes, 0.1)));
        expect(host.querySelectorAll('[data-canvas-detail="compact"]')).toHaveLength(300);
        expect(host.querySelectorAll('*')).toHaveLength(600);
        expect(host.textContent).not.toContain("空图片节点");
        vi.mocked(CanvasImage).mockClear();
        const hydrated = await hydrateCanvasImages(nodes);
        await act(async () => root.render(render(hydrated, 0.1)));
        expect(CanvasImage).not.toHaveBeenCalled();
        await act(async () => root.render(render(nodes, 0.1, "0")));
        expect(host.querySelectorAll('[data-canvas-detail="compact"]')).toHaveLength(299);
        const selected = host.querySelector('[data-node-id="0"]')!;
        expect(selected.querySelectorAll('[class*="resize"]')).toHaveLength(4);
        expect(selected.querySelectorAll('[data-connection-handle]')).toHaveLength(2);
        await act(async () => root.render(render(nodes, 0.61)));
        expect(host.querySelectorAll('[data-canvas-detail="compact"]')).toHaveLength(0);
        expect(host.querySelectorAll('*').length).toBeGreaterThan(6000);
    });
    it("图像只凭存储键也展示原始分辨率，不当成空节点", async () => {
        root = createRoot(host);
        const node: CanvasNodeData = {id:"stored",title:"原图",type:CanvasNodeType.Image,position:{x:0,y:0},width:280,height:200,metadata:{storageKey:"image:stored",naturalWidth:4096,naturalHeight:2048}};
        await act(async () => root.render(<CanvasNode {...fixed} data={node} scale={1} showImageInfo />));
        expect(host.textContent).toContain("4096×2048");
        expect(host.textContent).not.toContain("空图片节点");
    });
});
