export type CanvasPromptKeyboardState = {
    isComposing?: boolean;
    keyCode?: number;
};

export type CanvasPromptDomSyncAction = "skip-composition" | "consume-user-input" | "keep-dom" | "render";

// 中文输入法确认候选词时，不应触发生成或素材菜单快捷键。
export function isCanvasPromptImeEvent(compositionActive: boolean, event: CanvasPromptKeyboardState) {
    return compositionActive || Boolean(event.isComposing) || event.keyCode === 229;
}

// 文本内容一致时保留浏览器现有 DOM，避免重建节点后丢失光标、选区或输入法状态。
export function getCanvasPromptDomSyncAction({
    compositionActive,
    userInputPending,
    currentText,
    prompt,
    mentionStructureMatches,
}: {
    compositionActive: boolean;
    userInputPending: boolean;
    currentText: string;
    prompt: string;
    mentionStructureMatches: boolean;
}): CanvasPromptDomSyncAction {
    if (compositionActive) return "skip-composition";
    if (userInputPending) return "consume-user-input";
    if (currentText === prompt && mentionStructureMatches) return "keep-dom";
    return "render";
}
