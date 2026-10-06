// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasNodePromptPanel } from "./canvas-node-prompt-panel";
import { InfiniteCanvas } from "./infinite-canvas";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import type { NodeGenerationInput } from "./canvas-node-generation";

// 屏蔽与本次交互无关的模型网络请求，保留真实输入框、素材菜单和画布事件链。
vi.mock("./canvas-model-options", () => ({ useCanvasModelOptions: () => [] }));
vi.mock("@/components/model-picker", () => ({ ModelPicker: () => null }));
vi.mock("./canvas-video-settings-popover", () => ({ CanvasVideoSettingsPopover: () => null }));
vi.mock("./canvas-image-settings-popover", () => ({ CanvasImageSettingsPopover: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    host?.remove();
    Reflect.deleteProperty(document, "execCommand");
    vi.restoreAllMocks();
});

async function renderMenu(names = ["旁白女声.wav", "背景音乐.mp3"]) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const containerRef = createRef<HTMLDivElement>();
    const onViewportPreview = vi.fn();
    const onPromptChange = vi.fn();
    const node: CanvasNodeData = { id: "video", title: "视频", type: CanvasNodeType.Video, position: { x: 0, y: 0 }, width: 300, height: 200, metadata: {} };
    const inputs: NodeGenerationInput[] = names.map((name, index) => ({ nodeId: String(index), type: "audio", title: name, audio: { id: String(index), name, type: "audio/mpeg", url: "https://example.test/audio-" + index } }));
    await act(async () => root!.render(
        <InfiniteCanvas containerRef={containerRef} viewport={{ x: 0, y: 0, k: 1 }} onViewportChange={vi.fn()} onViewportPreview={onViewportPreview}>
            <CanvasNodePromptPanel node={node} canvasNodes={[node]} inputs={inputs} isRunning={false} onPromptChange={onPromptChange} onConfigChange={vi.fn()} onGenerate={vi.fn()} />
            <div data-canvas-no-zoom><span data-scroll-test="control">控件</span></div>
            <div className="ant-popover"><span data-scroll-test="popover">弹层</span></div>
        </InfiniteCanvas>,
    ));
    const editor = host.querySelector<HTMLDivElement>('[contenteditable="true"]')!;
    await act(async () => {
        editor.focus();
        editor.textContent = "@";
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "@" }));
    });
    const heading = Array.from(host.querySelectorAll("div")).find((el) => el.textContent === "选择引用素材");
    expect(heading).toBeDefined();
    const menu = heading!.nextElementSibling as HTMLDivElement;
    return { menu, editor, container: containerRef.current!, onViewportPreview, onPromptChange };
}

describe("画布素材引用菜单", () => {
    it("音频引用同时显示编号和名称，长名称保留完整悬停提示", async () => {
        const longName = "客户旁白录音完整版-第一场景-最终确认版.wav";
        const { menu } = await renderMenu([longName, "背景音乐.mp3"]);
        const buttons = menu.querySelectorAll("button");
        expect(buttons[0].textContent).toContain("@音频1");
        expect(buttons[0].textContent).toContain(longName);
        expect(buttons[0].title).toBe(longName);
        expect(buttons[1].textContent).toContain("背景音乐.mp3");
    });

    it("缺少音频名称时仍保留可区分的引用编号", async () => {
        const { menu } = await renderMenu(["", "   "]);
        expect(menu.textContent).toContain("@音频1");
        expect(menu.textContent).toContain("@音频2");
        expect(menu.textContent).toContain("未命名音频");
    });

    it("选择第二个同名音频仍插入正确编号，不把文件名拼入请求", async () => {
        const { menu, editor, onPromptChange } = await renderMenu(["同名.wav", "同名.wav"]);
        // 模拟浏览器保留编辑选区；模拟环境不实际实现富文本插入命令，验证真实回退分支。
        Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        act(() => menu.querySelectorAll("button")[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
        const prompt = onPromptChange.mock.lastCall?.[1] as string;
        expect(prompt).toContain("@音频2");
        expect(prompt).not.toContain("同名.wav");
    });

    it.each(["menu", "editor", "control", "popover"])("%s 的滚轮保留原生滚动且不缩放画布", async (targetName) => {
        const { menu, editor, onViewportPreview } = await renderMenu();
        const target = targetName === "menu" ? menu.querySelector("button")! : targetName === "editor" ? editor : host.querySelector('[data-scroll-test="' + targetName + '"]')!;
        for (const deltaY of [120, -120]) {
            const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY });
            act(() => target.dispatchEvent(event));
            expect(event.defaultPrevented).toBe(false);
        }
        expect(onViewportPreview).not.toHaveBeenCalled();
    });

    it("空白画布继续拦截页面滚动并执行缩放", async () => {
        const { container, onViewportPreview } = await renderMenu();
        const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
        act(() => container.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(true);
        expect(onViewportPreview).toHaveBeenCalledTimes(1);
    });
});
