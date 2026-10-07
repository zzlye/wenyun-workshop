// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { CanvasImageSizePanel } from "./canvas-image-settings-popover";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;

afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
});

async function renderModel(model: string, size = "1376x768") {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onConfigChange = vi.fn();
    const render = async (nextModel: string, nextSize: string) => act(async () => root.render(
        <CanvasImageSizePanel
            config={{ ...defaultConfig, model: nextModel, imageModel: nextModel, size: nextSize }}
            allowedTiers={["1K", "2K", "4K"]}
            qualityOptions={[]}
            allowCustomRatio
            onConfigChange={onConfigChange}
            theme={canvasThemes.dark}
        />,
    ));
    await render(model, size);
    return { onConfigChange, render };
}

describe("画布香蕉尺寸选择", () => {
    it("Pro 展示官方十种比例并提交官方尺寸", async () => {
        const { onConfigChange: onChange } = await renderModel("Nano-Banana-Pro");
        expect(host.querySelectorAll('button[data-image-ratio]')).toHaveLength(10);
        expect(host.textContent).not.toContain("自定义比例");
        await act(async () => host.querySelector<HTMLButtonElement>('button[data-image-ratio="4:5"]')!.click());
        expect(onChange).toHaveBeenCalledWith("size", "928x1152");
    });

    it("2.1 展示官方十四种比例且不提供 512px", async () => {
        const { onConfigChange: onChange } = await renderModel("nano-banana-2.1");
        expect(host.querySelectorAll('button[data-image-ratio]')).toHaveLength(14);
        expect(host.textContent).not.toContain("512px");
        await act(async () => host.querySelector<HTMLButtonElement>('button[data-image-ratio="1:8"]')!.click());
        expect(onChange).toHaveBeenCalledWith("size", "384x3072");
    });

    it("切换掉 512px 档时同步到 1K，不提交旧档位", async () => {
        const { onConfigChange, render } = await renderModel("nano-banana-2", "192x1536");
        expect(host.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.textContent).toBe("512px");
        await render("nano-banana-2.1", "192x1536");
        expect(host.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.textContent).toBe("1K");
        expect(host.querySelector<HTMLButtonElement>('button[data-image-ratio="1:8"]')?.getAttribute("aria-pressed")).toBe("true");
        expect(host.textContent).toContain("384x3072");
        expect(onConfigChange).not.toHaveBeenCalled();
    });
});
