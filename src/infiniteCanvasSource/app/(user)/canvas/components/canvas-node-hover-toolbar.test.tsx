// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { CanvasNodeHoverToolbar } from "./canvas-node-hover-toolbar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
});

describe("音频节点工具栏", () => {
    it.each([
        [undefined, "上传音频"],
        ["data:audio/mpeg;base64,fixture", "替换音频"],
    ])("音频内容为 %s 时显示上传操作", (content, label) => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
        const onUpload = vi.fn();
        const node: CanvasNodeData = {
            id: "audio-node",
            type: CanvasNodeType.Audio,
            title: "音频",
            position: { x: 0, y: 0 },
            width: 240,
            height: 160,
            metadata: { content },
        };
        const action = vi.fn();

        act(() => root?.render(<CanvasNodeHoverToolbar
            node={node}
            viewport={{ x: 0, y: 0, k: 1 }}
            onKeep={action}
            onLeave={action}
            onInfo={action}
            onEditText={action}
            onDecreaseFont={action}
            onIncreaseFont={action}
            onToggleDialog={action}
            onGenerateImage={action}
            onUpload={onUpload}
            onDownload={action}
            onSaveAsset={action}
            onCrop={action}
            onGridCrop={action}
            onCustomGridCrop={action}
            onAngle={action}
            onViewImage={action}
            onRetry={action}
            onToggleFreeResize={action}
            onDelete={action}
        />));

        const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
        expect(button).not.toBeNull();
        act(() => button?.click());
        expect(onUpload).toHaveBeenCalledWith(node);
    });
});
