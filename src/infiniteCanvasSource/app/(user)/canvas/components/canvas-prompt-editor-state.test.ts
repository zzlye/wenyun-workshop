import { describe, expect, it } from "vitest";

import { getCanvasPromptDomSyncAction, isCanvasPromptImeEvent } from "./canvas-prompt-editor-state";

describe("canvas prompt editor state", () => {
    it("输入法组词期间忽略键盘快捷操作", () => {
        expect(isCanvasPromptImeEvent(true, { isComposing: false, keyCode: 13 })).toBe(true);
        expect(isCanvasPromptImeEvent(false, { isComposing: true, keyCode: 13 })).toBe(true);
        expect(isCanvasPromptImeEvent(false, { isComposing: false, keyCode: 229 })).toBe(true);
    });

    it("普通回车不被识别为输入法事件", () => {
        expect(isCanvasPromptImeEvent(false, { isComposing: false, keyCode: 13 })).toBe(false);
    });

    it("输入法组词期间不重建编辑器 DOM", () => {
        expect(
            getCanvasPromptDomSyncAction({
                compositionActive: true,
                userInputPending: false,
                currentText: "ceshi",
                prompt: "测试",
                mentionStructureMatches: true,
            }),
        ).toBe("skip-composition");
    });

    it("用户输入触发的状态更新只消费标记，不回写 DOM", () => {
        expect(
            getCanvasPromptDomSyncAction({
                compositionActive: false,
                userInputPending: true,
                currentText: "测试",
                prompt: "测试",
                mentionStructureMatches: true,
            }),
        ).toBe("consume-user-input");
    });

    it("文本一致时保留浏览器 DOM 和当前选区", () => {
        expect(
            getCanvasPromptDomSyncAction({
                compositionActive: false,
                userInputPending: false,
                currentText: "测试中文输入",
                prompt: "测试中文输入",
                mentionStructureMatches: true,
            }),
        ).toBe("keep-dom");
    });

    it("外部文本真正变化时才重新渲染 DOM", () => {
        expect(
            getCanvasPromptDomSyncAction({
                compositionActive: false,
                userInputPending: false,
                currentText: "旧内容",
                prompt: "新内容",
                mentionStructureMatches: true,
            }),
        ).toBe("render");
    });

    it("素材引用结构变化时重新渲染 DOM", () => {
        expect(
            getCanvasPromptDomSyncAction({
                compositionActive: false,
                userInputPending: false,
                currentText: "引用素材",
                prompt: "引用素材",
                mentionStructureMatches: false,
            }),
        ).toBe("render");
    });
});
