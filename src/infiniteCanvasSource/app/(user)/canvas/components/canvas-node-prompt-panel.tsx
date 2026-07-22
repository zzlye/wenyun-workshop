"use client";

import { Children, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, KeyboardEvent, ReactNode } from "react";
import { ArrowUp, AudioLines, Link2, LoaderCircle, Paintbrush, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { Button, Empty, Input, Modal, Tabs, Tag } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { imageToDataUrl, uploadImage } from "@/services/image-storage";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { assetTagOptions, assetTagValues, getAssetTag, normalizeAssetTag, type AssetTag } from "@/lib/asset-tags";
import type { InputImage } from "../../../../../types";
import { getActiveApiProfile, getApiModelUnitCostText, normalizeImageModelForProfile, normalizeImageSizeForProfile, normalizeSettings } from "../../../../../lib/apiProfiles";
import { audioMentionMatches, getAtImageQuery, getAudioMentionLabel, getImageMentionLabel, getPromptIndexFromVisibleIndex, getPromptMentionParts, getSelectedImageMentionLabel, getSelectedTextMentionLabel, imageMentionMatches, insertAudioMentionAtVisibleRange, insertImageMentionAtVisibleRange, isCursorInSelectedImageMention, remapImageMentionsForOrder, stripImageMentionMarkers } from "../../../../../lib/promptImageMentions";
import { storeImage } from "../../../../../lib/db";
import { useCanvasModelOptions } from "./canvas-model-options";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { getCanvasPromptDomSyncAction, isCanvasPromptImeEvent } from "./canvas-prompt-editor-state";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasReferenceImage } from "../types";
import { buildConnectedPromptText, getNodeGenerationInputReferenceAudios, getNodeGenerationInputReferenceImages, hasUsableNodeGenerationPrompt, mergeNodeReferenceImages, referenceAudioIdentity, referenceImageIdentity, stripConnectedPromptSuffix, type NodeGenerationInput } from "./canvas-node-generation";
import { createInputImageFromFile, primeImageCache, useStore } from "../../../../../store";
import type { ReferenceAudio } from "@/types/image";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    canvasNodes: CanvasNodeData[];
    inputs?: NodeGenerationInput[];
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
};

type ReferencePickerCategory = AssetTag;
type AtMediaOption = { key: string; kind: "image"; label: string; image: InputImage; imageIndex: number; source: string } | { key: string; kind: "audio"; label: string; audio: ReferenceAudio; audioIndex: number; source: string };

const MAX_REFERENCE_IMAGES = 16;
const referenceCategoryOptions = assetTagOptions;
const EMPTY_REFERENCE_IMAGES: CanvasReferenceImage[] = [];
const EMPTY_NODE_INPUTS: NodeGenerationInput[] = [];

export function CanvasNodePromptPanel({ node, canvasNodes, inputs = EMPTY_NODE_INPUTS, isRunning, onPromptChange, onConfigChange, onGenerate, onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const inputRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const replaceFileInputRef = useRef<HTMLInputElement>(null);
    const replaceReferenceTargetRef = useRef<{ index: number; id: string } | null>(null);
    const pendingMaskEditRef = useRef<{ index: number; id: string; startedAt: number } | null>(null);
    const isUserInputRef = useRef(false);
    const isComposingRef = useRef(false);
    const compositionSyncTimerRef = useRef<number | null>(null);
    const globalConfig = useEffectiveConfig();
    const modelCosts = useConfigStore((state) => state.publicSettings?.modelChannel.modelCosts);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const settings = useStore((state) => state.settings);
    const setSettings = useStore((state) => state.setSettings);
    const setConfirmDialog = useStore((state) => state.setConfirmDialog);
    const setLightboxImageId = useStore((state) => state.setLightboxImageId);
    const setMaskEditorImageId = useStore((state) => state.setMaskEditorImageId);
    const maskEditorImageId = useStore((state) => state.maskEditorImageId);
    const setInputImages = useStore((state) => state.setInputImages);
    const sharedInputImages = useStore((state) => state.inputImages);
    const maskDraft = useStore((state) => state.maskDraft);
    const showToast = useStore((state) => state.showToast);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const activeProfile = useMemo(() => getActiveApiProfile(normalizeSettings(settings)), [settings]);
    const mode = defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode, activeProfile.id);
    const modelOptions = useCanvasModelOptions(config, mode, activeProfile.id);
    const connectedPromptText = useMemo(() => buildConnectedPromptText(inputs), [inputs]);
    const [prompt, setPrompt] = useState(() => stripConnectedPromptSuffix(node.metadata?.prompt || "", connectedPromptText));
    const canSubmitPrompt = hasUsableNodeGenerationPrompt(prompt, connectedPromptText);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const [cursorPos, setCursorPos] = useState(0);
    const [menuLeft, setMenuLeft] = useState(0);
    const [atImageMenuIndex, setAtImageMenuIndex] = useState(0);
    const [atImageMenuDismissed, setAtImageMenuDismissed] = useState(false);
    const [referencePickerOpen, setReferencePickerOpen] = useState(false);
    const referenceImages = node.metadata?.referenceImages || EMPTY_REFERENCE_IMAGES;
    const connectedReferenceImages = useMemo(() => getNodeGenerationInputReferenceImages(inputs), [inputs]);
    const connectedReferenceAudios = useMemo(() => (mode === "video" ? getNodeGenerationInputReferenceAudios(inputs) : []), [inputs, mode]);
    const connectedReferenceKeys = useMemo(() => new Set(connectedReferenceImages.map(referenceImageIdentity)), [connectedReferenceImages]);
    const mentionableReferences = useMemo(() => mergeNodeReferenceImages(referenceImages, connectedReferenceImages), [connectedReferenceImages, referenceImages]);
    const mentionableInputImages = useMemo<InputImage[]>(() => mentionableReferences.map(referenceToInputImage), [mentionableReferences]);
    const connectedReferenceItems = useMemo(
        () =>
            connectedReferenceImages
                .map((image) => ({ image, mentionIndex: mentionableReferences.findIndex((item) => referenceImageIdentity(item) === referenceImageIdentity(image)) }))
                .filter((item) => item.mentionIndex >= 0),
        [connectedReferenceImages, mentionableReferences],
    );
    const connectedAudioItems = useMemo(
        () => connectedReferenceAudios.map((audio, index) => ({ audio, mentionIndex: index })),
        [connectedReferenceAudios],
    );
    const referenceImagesRef = useRef(referenceImages);
    const mentionableReferencesRef = useRef(mentionableReferences);
    const promptRef = useRef(prompt);
    const credits = requestCreditCost({ channelMode: config.channelMode, modelCosts, model: config.model, count: mode === "image" ? config.count : 1 });
    const imageCostText = mode === "image" ? (getApiModelUnitCostText(settings, activeProfile.id, config.model) ?? "HUHN --") : null;
    const atReferenceLimit = referenceImages.length >= MAX_REFERENCE_IMAGES;
    const visiblePrompt = stripImageMentionMarkers(prompt);
    const mentionableMediaCount = mentionableInputImages.length + connectedReferenceAudios.length;
    const atImageQuery = isCursorInSelectedImageMention(prompt, cursorPos) ? null : getAtImageQuery(visiblePrompt, cursorPos, { length: mentionableMediaCount });
    const atMediaOptions: AtMediaOption[] = useMemo(() => {
        if (!atImageQuery) return [];
        const imageOptions: AtMediaOption[] = mentionableReferences
            .map((reference, index) => ({ key: referenceImageIdentity(reference), kind: "image" as const, label: getImageMentionLabel(index), image: referenceToInputImage(reference), imageIndex: index, source: connectedReferenceKeys.has(referenceImageIdentity(reference)) ? "连接图" : "参考图" }))
            .filter((option) => imageMentionMatches(atImageQuery.query, option.imageIndex));
        const audioOptions: AtMediaOption[] = connectedReferenceAudios
            .map((audio, index) => ({ key: referenceAudioIdentity(audio), kind: "audio" as const, label: getAudioMentionLabel(index), audio, audioIndex: index, source: "连接音频" }))
            .filter((option) => audioMentionMatches(atImageQuery.query, option.audioIndex));
        return [...imageOptions, ...audioOptions];
    }, [atImageQuery, connectedReferenceAudios, connectedReferenceKeys, mentionableReferences]);
    const showAtImageMenu = !atImageMenuDismissed && atMediaOptions.length > 0;

    useEffect(() => {
        referenceImagesRef.current = referenceImages;
    }, [referenceImages]);

    useEffect(() => {
        mentionableReferencesRef.current = mentionableReferences;
    }, [mentionableReferences]);

    useEffect(() => {
        promptRef.current = prompt;
    }, [prompt]);

    useEffect(() => {
        const rawPrompt = node.metadata?.prompt || "";
        const displayPrompt = stripConnectedPromptSuffix(rawPrompt, connectedPromptText);
        if (displayPrompt === promptRef.current) {
            if (displayPrompt !== rawPrompt) onPromptChange(node.id, displayPrompt);
            return;
        }
        if (isComposingRef.current) return;
        promptRef.current = displayPrompt;
        setPrompt(displayPrompt);
        if (displayPrompt !== rawPrompt) onPromptChange(node.id, displayPrompt);
        isUserInputRef.current = false;
    }, [connectedPromptText, node.id, node.metadata?.prompt, onPromptChange]);

    const updatePrompt = useCallback(
        (value: string) => {
            promptRef.current = value;
            setPrompt(value);
            onPromptChange(node.id, value);
        },
        [node.id, onPromptChange],
    );

    const syncPromptFromInput = useCallback(() => {
        const el = inputRef.current;
        if (!el) return;
        isUserInputRef.current = true;
        const range = getContentEditableSelection(el);
        setCursorPos(range.start);
        syncMentionTagSelection(el);
        updatePrompt(getContentEditablePlainText(el));
    }, [updatePrompt]);

    const finishPromptComposition = useCallback(() => {
        isComposingRef.current = false;
        if (compositionSyncTimerRef.current !== null) window.clearTimeout(compositionSyncTimerRef.current);
        // 部分浏览器会在 compositionend 之后才写入最终汉字，延后一轮再同步可避免残留拼音。
        compositionSyncTimerRef.current = window.setTimeout(() => {
            compositionSyncTimerRef.current = null;
            syncPromptFromInput();
            setAtImageMenuIndex(0);
            setAtImageMenuDismissed(false);
        }, 0);
    }, [syncPromptFromInput]);

    useEffect(
        () => () => {
            if (compositionSyncTimerRef.current !== null) window.clearTimeout(compositionSyncTimerRef.current);
        },
        [],
    );

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        const parts = getPromptMentionParts(prompt, mentionableInputImages);
        const expectedMentions = parts
            .filter((part) => part.type === "mention")
            .map((part) => ({
                text: part.text,
                mentionText: part.mentionText ?? getSelectedImageMentionLabel(part.imageIndex ?? 0),
            }));
        const syncAction = getCanvasPromptDomSyncAction({
            compositionActive: isComposingRef.current,
            userInputPending: isUserInputRef.current,
            currentText: getContentEditablePlainText(el),
            prompt,
            mentionStructureMatches: contentEditableMentionsMatch(el, expectedMentions),
        });
        if (syncAction === "consume-user-input") {
            isUserInputRef.current = false;
            return;
        }
        if (syncAction !== "render") return;
        const selection = document.activeElement === el ? getContentEditableSelection(el) : null;
        const html = prompt
            ? parts
                  .map((part) =>
                      part.type === "mention"
                          ? `<span contenteditable="false" class="mention-tag" data-mention-text="${escapeHtml(part.mentionText ?? getSelectedImageMentionLabel(part.imageIndex ?? 0))}">${escapeHtml(part.text)}</span>`
                          : escapeHtml(part.text),
                  )
                  .join("")
            : "";
        if (el.innerHTML !== html) {
            el.innerHTML = html;
            if (selection) {
                if (selection.start === selection.end) setContentEditableCursor(el, selection.start);
                else setContentEditableSelection(el, selection.start, selection.end);
            }
        }
    }, [prompt, mentionableInputImages]);

    useEffect(() => {
        const handleSelectionChange = () => {
            const el = inputRef.current;
            if (!el) return;
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const domRange = sel.getRangeAt(0);
            try {
                if (!domRange.intersectsNode(el)) {
                    syncMentionTagSelection(el);
                    return;
                }
            } catch {
                return;
            }
            const range = getContentEditableSelection(el);
            setCursorPos(range.start);
            syncMentionTagSelection(el);
            const rangeRect = domRange.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            if (rangeRect.width === 0 && rangeRect.height === 0) return;
            setMenuLeft(rangeRect.left - elRect.left);
        };
        document.addEventListener("selectionchange", handleSelectionChange);
        return () => document.removeEventListener("selectionchange", handleSelectionChange);
    }, []);

    const commitReferenceImages = useCallback(
        (nextReferences: CanvasReferenceImage[], nextPrompt = prompt) => {
            onConfigChange(node.id, { referenceImages: nextReferences.slice(0, MAX_REFERENCE_IMAGES) });
            updatePrompt(nextPrompt);
        },
        [node.id, onConfigChange, prompt, updatePrompt],
    );

    const addReferenceImages = useCallback(
        (images: CanvasReferenceImage[]) => {
            const seen = new Set(referenceImages.map(referenceIdentity));
            const merged = [...referenceImages];
            for (const image of images) {
                const key = referenceIdentity(image);
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push(image);
            }
            const nextPrompt = remapImageMentionsForOrder(prompt, mentionableInputImages, mergeNodeReferenceImages(merged, connectedReferenceImages).map(referenceToInputImage));
            commitReferenceImages(merged, nextPrompt);
        },
        [commitReferenceImages, connectedReferenceImages, mentionableInputImages, prompt, referenceImages],
    );

    const replaceReference = useCallback(
        (index: number, image: CanvasReferenceImage) => {
            const previous = referenceImages[index];
            if (!previous) return;
            if (referenceImages.some((item, itemIndex) => itemIndex !== index && referenceIdentity(item) === referenceIdentity(image))) {
                showToast("这张图片已在参考图中", "info");
                return;
            }
            const nextReferences = referenceImages.map((item, itemIndex) => (itemIndex === index ? image : item));
            const nextPrompt = remapImageMentionsForOrder(
                prompt,
                mentionableInputImages,
                mergeNodeReferenceImages(nextReferences, connectedReferenceImages).map(referenceToInputImage),
                { [previous.id]: image.id },
            );
            commitReferenceImages(nextReferences, nextPrompt);
            showToast("参考图已替换", "success");
        },
        [commitReferenceImages, connectedReferenceImages, mentionableInputImages, prompt, referenceImages, showToast],
    );

    const removeReference = useCallback(
        (index: number) => {
            const nextReferences = referenceImages.filter((_, itemIndex) => itemIndex !== index);
            const nextPrompt = remapImageMentionsForOrder(prompt, mentionableInputImages, mergeNodeReferenceImages(nextReferences, connectedReferenceImages).map(referenceToInputImage));
            commitReferenceImages(nextReferences, nextPrompt);
        },
        [commitReferenceImages, connectedReferenceImages, mentionableInputImages, prompt, referenceImages],
    );

    const clearReferenceImages = useCallback(() => {
        if (!referenceImages.length) return;
        setConfirmDialog({
            title: "清空参考图",
            message: `确定要清空全部 ${referenceImages.length} 张参考图吗？`,
            action: () => commitReferenceImages([], remapImageMentionsForOrder(prompt, mentionableInputImages, mergeNodeReferenceImages([], connectedReferenceImages).map(referenceToInputImage))),
        });
    }, [commitReferenceImages, connectedReferenceImages, mentionableInputImages, prompt, referenceImages.length, setConfirmDialog]);

    const addReferenceFiles = useCallback(
        async (files?: FileList | File[] | null) => {
            try {
                const images = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
                if (!images.length) return;
                const slots = Math.max(0, MAX_REFERENCE_IMAGES - referenceImages.length);
                if (slots <= 0) {
                    showToast(`参考图数量已达上限（${MAX_REFERENCE_IMAGES} 张），无法继续添加`, "error");
                    return;
                }
                const uploaded = await Promise.all(images.slice(0, slots).map((file) => createCanvasReferenceImage(file, node.id)));
                addReferenceImages(uploaded);
                if (images.length > uploaded.length) showToast(`已达上限 ${MAX_REFERENCE_IMAGES} 张，${images.length - uploaded.length} 张图片被丢弃`, "error");
            } catch (error) {
                showToast(`图片添加失败：${error instanceof Error ? error.message : String(error)}`, "error");
            }
        },
        [addReferenceImages, node.id, referenceImages.length, showToast],
    );

    const insertPromptTextAtSelection = useCallback(
        (text: string) => {
            const normalizedText = text.replace(/\r\n?/g, "\n");
            const el = inputRef.current;
            if (el) {
                el.focus();
                if (document.execCommand("insertText", false, normalizedText)) {
                    syncPromptFromInput();
                    return;
                }
            }

            const selection = el ? getContentEditableSelection(el) : { start: cursorPos, end: cursorPos };
            const promptStart = getPromptIndexFromVisibleIndex(prompt, selection.start);
            const promptEnd = getPromptIndexFromVisibleIndex(prompt, selection.end);
            const nextPrompt = `${prompt.slice(0, promptStart)}${normalizedText}${prompt.slice(promptEnd)}`;
            const nextCursor = selection.start + normalizedText.length;
            isUserInputRef.current = false;
            updatePrompt(nextPrompt);
            window.setTimeout(() => {
                if (!inputRef.current) return;
                inputRef.current.focus();
                setContentEditableCursor(inputRef.current, nextCursor);
            }, 0);
        },
        [cursorPos, prompt, syncPromptFromInput, updatePrompt],
    );

    const handlePromptPaste = useCallback(
        (event: ReactClipboardEvent<HTMLDivElement>) => {
            event.stopPropagation();
            const imageFiles = Array.from(event.clipboardData.items)
                .filter((item) => item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file));
            if (imageFiles.length) {
                event.preventDefault();
                void addReferenceFiles(imageFiles);
                return;
            }

            const text = event.clipboardData.getData("text/plain");
            if (!text) return;
            event.preventDefault();
            insertPromptTextAtSelection(text);
        },
        [addReferenceFiles, insertPromptTextAtSelection],
    );

    const handlePromptCopy = useCallback(
        (event: ReactClipboardEvent<HTMLDivElement>) => {
            event.stopPropagation();
            const el = inputRef.current;
            if (!el) return;
            const selection = getContentEditableSelection(el);
            if (selection.start === selection.end) return;
            const promptStart = getPromptIndexFromVisibleIndex(prompt, selection.start);
            const promptEnd = getPromptIndexFromVisibleIndex(prompt, selection.end);
            const text = stripImageMentionMarkers(prompt.slice(promptStart, promptEnd));
            event.preventDefault();
            event.clipboardData.setData("text/plain", /^\s*@图\d+\s*$/.test(text) ? text.trim() : text);
        },
        [prompt],
    );

    useEffect(() => {
        const handleDocumentPaste = (event: ClipboardEvent) => {
            if (event.defaultPrevented) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest("input, textarea, [contenteditable='true']")) return;
            const imageFiles = Array.from(event.clipboardData?.items || [])
                .filter((item) => item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file));
            if (!imageFiles.length) return;
            event.preventDefault();
            void addReferenceFiles(imageFiles);
        };
        document.addEventListener("paste", handleDocumentPaste);
        return () => document.removeEventListener("paste", handleDocumentPaste);
    }, [addReferenceFiles]);

    const handleReplaceFileUpload = useCallback(
        async (event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            const target = replaceReferenceTargetRef.current;
            replaceReferenceTargetRef.current = null;
            if (!file || !target) return;
            if (!file.type.startsWith("image/")) {
                showToast("请选择有效图片", "error");
                return;
            }
            try {
                replaceReference(target.index, await createCanvasReferenceImage(file, node.id));
            } catch (error) {
                showToast(`参考图替换失败：${error instanceof Error ? error.message : String(error)}`, "error");
            }
        },
        [node.id, replaceReference, showToast],
    );

    const selectAtMediaOption = useCallback(
        (option: AtMediaOption) => {
            const el = inputRef.current;
            const cursor = el ? getContentEditableCursor(el) : prompt.length;
            const query = getAtImageQuery(stripImageMentionMarkers(prompt), cursor, { length: mentionableMediaCount });
            setAtImageMenuDismissed(true);
            setAtImageMenuIndex(0);
            if (!query) return;

            const label = option.kind === "image" ? getImageMentionLabel(option.imageIndex) : getAudioMentionLabel(option.audioIndex);
            const nextCursor = query.start + label.length;
            if (el) {
                el.focus();
                setContentEditableSelection(el, query.start, cursor);
                if (document.execCommand("insertHTML", false, getMentionTagHtml(label))) {
                    setContentEditableCursor(el, nextCursor);
                    syncPromptFromInput();
                    return;
                }
            }

            const next = option.kind === "image" ? insertImageMentionAtVisibleRange(prompt, query.start, cursor, option.imageIndex) : insertAudioMentionAtVisibleRange(prompt, query.start, cursor, option.audioIndex);
            isUserInputRef.current = false;
            updatePrompt(next.prompt);
            window.setTimeout(() => {
                if (!inputRef.current) return;
                inputRef.current.focus();
                setContentEditableCursor(inputRef.current, next.cursor);
            }, 0);
        },
        [mentionableMediaCount, prompt, syncPromptFromInput, updatePrompt],
    );

    const insertImageMentionAtCursor = useCallback(
        (imageIndex: number) => {
            const el = inputRef.current;
            const cursor = el ? getContentEditableCursor(el) : cursorPos;
            const nextCursor = cursor + getImageMentionLabel(imageIndex).length;
            if (el) {
                el.focus();
                setContentEditableCursor(el, cursor);
                if (document.execCommand("insertHTML", false, getMentionTagHtml(getImageMentionLabel(imageIndex)))) {
                    setContentEditableCursor(el, nextCursor);
                    syncPromptFromInput();
                    return;
                }
            }
            const next = insertImageMentionAtVisibleRange(prompt, cursor, cursor, imageIndex);
            isUserInputRef.current = false;
            updatePrompt(next.prompt);
            window.setTimeout(() => {
                if (!inputRef.current) return;
                inputRef.current.focus();
                setContentEditableCursor(inputRef.current, next.cursor);
            }, 0);
        },
        [cursorPos, prompt, syncPromptFromInput, updatePrompt],
    );

    const insertAudioMentionAtCursor = useCallback(
        (audioIndex: number) => {
            const el = inputRef.current;
            const cursor = el ? getContentEditableCursor(el) : cursorPos;
            const label = getAudioMentionLabel(audioIndex);
            const nextCursor = cursor + label.length;
            if (el) {
                el.focus();
                setContentEditableCursor(el, cursor);
                if (document.execCommand("insertHTML", false, getMentionTagHtml(label))) {
                    setContentEditableCursor(el, nextCursor);
                    syncPromptFromInput();
                    return;
                }
            }
            const next = insertAudioMentionAtVisibleRange(prompt, cursor, cursor, audioIndex);
            isUserInputRef.current = false;
            updatePrompt(next.prompt);
            window.setTimeout(() => {
                if (!inputRef.current) return;
                inputRef.current.focus();
                setContentEditableCursor(inputRef.current, next.cursor);
            }, 0);
        },
        [cursorPos, prompt, syncPromptFromInput, updatePrompt],
    );

    const openReferenceLightbox = useCallback(
        async (index: number) => {
            const images = referenceImagesRef.current;
            const target = images[index];
            if (!target) return;
            const cachedImages = await Promise.all(images.map(cacheReferenceForSharedTools));
            const cached = cachedImages[index];
            if (!cached) return;
            setLightboxImageId(cached.id, cachedImages.filter((image): image is InputImage => Boolean(image)).map((image) => image.id));
        },
        [setLightboxImageId],
    );

    const openMentionableReferenceLightbox = useCallback(
        async (index: number) => {
            const images = mentionableReferencesRef.current;
            const target = images[index];
            if (!target) return;
            const cachedImages = await Promise.all(images.map(cacheReferenceForSharedTools));
            const cached = cachedImages[index];
            if (!cached) return;
            setLightboxImageId(cached.id, cachedImages.filter((image): image is InputImage => Boolean(image)).map((image) => image.id));
        },
        [setLightboxImageId],
    );

    const openReplaceReferenceFilePicker = useCallback((index: number, imageId: string) => {
        replaceReferenceTargetRef.current = { index, id: imageId };
        replaceFileInputRef.current?.click();
    }, []);

    const openMaskEditorForReference = useCallback(
        async (index: number, imageId: string) => {
            const cachedReferences = await Promise.all(referenceImagesRef.current.map(cacheReferenceForSharedTools));
            const targetImage = cachedReferences[index];
            if (!targetImage) {
                showToast("参考图已丢失，无法编辑遮罩", "error");
                return;
            }
            const cachedImages = cachedReferences.filter((image): image is InputImage => Boolean(image));
            setInputImages(cachedImages);
            pendingMaskEditRef.current = { index, id: imageId, startedAt: Date.now() };
            setMaskEditorImageId(targetImage.id);
        },
        [setInputImages, setMaskEditorImageId, showToast],
    );

    const commitReferenceEditChoice = useCallback(
        (choice: "replace-reference" | "add-mask", remember?: boolean) => {
            if (remember) setSettings({ referenceImageEditAction: choice });
        },
        [setSettings],
    );

    const editReferenceImage = useCallback(
        (index: number) => {
            const image = referenceImages[index];
            if (!image) return;
            if (settings.referenceImageEditAction === "replace-reference") {
                openReplaceReferenceFilePicker(index, image.id);
                return;
            }
            if (settings.referenceImageEditAction === "add-mask") {
                void openMaskEditorForReference(index, image.id);
                return;
            }
            setConfirmDialog({
                title: "编辑参考图",
                message: "请选择这次要执行的操作。若不勾选下方的选项，则每次都询问；勾选后可在设置里修改选择。",
                checkbox: { label: "以后默认执行此选择" },
                buttons: [
                    {
                        label: "替换参考图",
                        tone: "secondary",
                        action: (remember) => {
                            commitReferenceEditChoice("replace-reference", remember);
                            openReplaceReferenceFilePicker(index, image.id);
                        },
                    },
                    {
                        label: "添加遮罩",
                        tone: "primary",
                        action: (remember) => {
                            commitReferenceEditChoice("add-mask", remember);
                            void openMaskEditorForReference(index, image.id);
                        },
                    },
                ],
            });
        },
        [commitReferenceEditChoice, openMaskEditorForReference, openReplaceReferenceFilePicker, referenceImages, setConfirmDialog, settings.referenceImageEditAction],
    );

    useEffect(() => {
        const pending = pendingMaskEditRef.current;
        if (!pending || maskEditorImageId) return;
        if (!maskDraft || maskDraft.updatedAt < pending.startedAt) return;
        const sharedImage = sharedInputImages.find((image) => image.id === maskDraft.targetImageId);
        const previousReferences = referenceImagesRef.current;
        const currentIndex = previousReferences.findIndex((image) => image.id === pending.id);
        const targetIndex = currentIndex >= 0 ? currentIndex : pending.index;
        const previous = previousReferences[targetIndex];
        if (!previous || !sharedImage) return;

        const nextReference: CanvasReferenceImage = {
            ...previous,
            id: sharedImage.id,
            dataUrl: sharedImage.dataUrl,
            type: previous.type || "image/png",
            mimeType: previous.mimeType || "image/png",
            maskDataUrl: maskDraft.maskDataUrl,
            isMaskTarget: true,
        };
        const nextReferences = [nextReference, ...previousReferences.filter((_, index) => index !== targetIndex).map((image) => ({ ...image, isMaskTarget: false, maskDataUrl: undefined }))];
        const nextPrompt = remapImageMentionsForOrder(
            promptRef.current,
            mentionableInputImages,
            mergeNodeReferenceImages(nextReferences, connectedReferenceImages).map(referenceToInputImage),
            { [previous.id]: nextReference.id },
        );
        pendingMaskEditRef.current = null;
        commitReferenceImages(nextReferences, nextPrompt);
    }, [commitReferenceImages, connectedReferenceImages, maskDraft, maskEditorImageId, mentionableInputImages, sharedInputImages]);

    const submit = useCallback(() => {
        const text = prompt.trim();
        if (!hasUsableNodeGenerationPrompt(text, connectedPromptText) || isRunning) return;
        onPromptChange(node.id, text);
        onGenerate(node.id, mode, text);
    }, [connectedPromptText, isRunning, mode, node.id, onGenerate, onPromptChange, prompt]);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (isCanvasPromptImeEvent(isComposingRef.current, event.nativeEvent)) return;
        if (showAtImageMenu) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setAtImageMenuIndex((index) => (event.key === "ArrowDown" ? (index + 1) % atMediaOptions.length : (index - 1 + atMediaOptions.length) % atMediaOptions.length));
                return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                selectAtMediaOption(atMediaOptions[Math.max(0, Math.min(atImageMenuIndex, atMediaOptions.length - 1))]);
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                setAtImageMenuDismissed(true);
                return;
            }
        }

        if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        submit();
    };

    return (
        <div
            data-canvas-editor
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="rounded-xl border p-2 shadow-sm" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                {connectedReferenceItems.length > 0 || connectedAudioItems.length > 0 ? (
                    <div className="mb-2 rounded-xl border border-blue-200/70 bg-blue-50/70 p-2 dark:border-blue-400/20 dark:bg-blue-500/10">
                        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-300">
                            <Link2 className="size-3.5" />
                            已连接素材
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fill,52px)] gap-x-2 gap-y-3">
                            {connectedReferenceItems.map(({ image, mentionIndex }) => (
                                <button
                                    key={referenceImageIdentity(image)}
                                    type="button"
                                    className="group/ref relative block h-[52px] w-[52px] overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm transition hover:border-blue-400 dark:border-blue-400/30 dark:bg-white/[0.04]"
                                    onClick={() => void openMentionableReferenceLightbox(mentionIndex)}
                                    onContextMenu={(event) => {
                                        event.preventDefault();
                                        insertImageMentionAtCursor(mentionIndex);
                                    }}
                                    title="预览连接图片，右键插入 @图"
                                >
                                    <img src={image.dataUrl} alt={image.name} className="h-full w-full object-cover transition-opacity group-hover/ref:opacity-90" />
                                    <span className="pointer-events-none absolute bottom-1 left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600/85 px-1 text-[9px] font-semibold leading-none text-white backdrop-blur-sm">{mentionIndex + 1}</span>
                                </button>
                            ))}
                            {connectedAudioItems.map(({ audio, mentionIndex }) => (
                                <button
                                    key={referenceAudioIdentity(audio)}
                                    type="button"
                                    className="group/ref relative flex h-[52px] w-[52px] flex-col items-center justify-center overflow-hidden rounded-xl border border-blue-200 bg-white text-blue-600 shadow-sm transition hover:border-blue-400 dark:border-blue-400/30 dark:bg-white/[0.04] dark:text-blue-300"
                                    onContextMenu={(event) => {
                                        event.preventDefault();
                                        insertAudioMentionAtCursor(mentionIndex);
                                    }}
                                    title="右键插入 @音频"
                                >
                                    <AudioLines className="size-5" />
                                    <span className="mt-1 max-w-10 truncate text-[9px]">{audio.name}</span>
                                    <span className="pointer-events-none absolute bottom-1 left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600/85 px-1 text-[9px] font-semibold leading-none text-white backdrop-blur-sm">{mentionIndex + 1}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}
                <div className="mb-2 grid grid-cols-[repeat(auto-fill,52px)] gap-x-2 gap-y-3">
                    {referenceImages.map((image, index) => (
                        <div
                            key={image.id}
                            className="group/ref relative h-[52px] w-[52px] shrink-0 overflow-visible"
                            onContextMenu={(event) => {
                                event.preventDefault();
                                insertImageMentionAtCursor(index);
                            }}
                        >
                            <button
                                type="button"
                                className="relative block h-[52px] w-[52px] overflow-hidden rounded-xl border shadow-sm"
                                style={{ borderColor: image.isMaskTarget ? "#3b82f6" : theme.node.stroke }}
                                onClick={() => void openReferenceLightbox(index)}
                                title="预览参考图，右键插入 @图"
                            >
                                <img src={image.dataUrl || image.url} alt={image.name} className="h-full w-full object-cover transition-opacity group-hover/ref:opacity-90" />
                                {image.isMaskTarget ? <span className="pointer-events-none absolute left-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[8px] font-bold leading-none text-white">MASK</span> : null}
                                <span className="pointer-events-none absolute bottom-1 left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/55 px-1 text-[9px] font-semibold leading-none text-white backdrop-blur-sm">{index + 1}</span>
                                <span className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/ref:opacity-100">
                                    <Paintbrush className="size-5 text-white" />
                                </span>
                            </button>
                            <button
                                type="button"
                                className="absolute inset-0 z-20 grid place-items-center opacity-0 transition-opacity group-hover/ref:opacity-100"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    editReferenceImage(index);
                                }}
                                aria-label="编辑参考图"
                                title="编辑参考图"
                            >
                                <span className="sr-only">编辑参考图</span>
                            </button>
                            <button
                                type="button"
                                className="absolute right-0 top-0 z-30 grid size-5 translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition hover:bg-red-600 group-hover/ref:opacity-100"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    removeReference(index);
                                }}
                                aria-label="移除参考图"
                                title="移除参考图"
                            >
                                <X className="size-3" />
                            </button>
                        </div>
                    ))}
                    {referenceImages.length > 0 ? (
                        <button
                            type="button"
                            className="flex h-[52px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed text-[10px] transition hover:border-red-300 hover:bg-red-50/50 hover:text-red-500 dark:hover:bg-red-950/30"
                            style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.placeholder }}
                            onClick={clearReferenceImages}
                            title="清空全部参考图"
                        >
                            <Trash2 className="size-4" />
                            清空
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-xl border border-dashed text-[10px] transition hover:border-blue-300 hover:bg-blue-50/60 disabled:cursor-not-allowed disabled:opacity-45 dark:hover:border-blue-400/40 dark:hover:bg-blue-500/10"
                        style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                        onClick={() => !atReferenceLimit && setReferencePickerOpen(true)}
                        disabled={atReferenceLimit}
                        title={atReferenceLimit ? `最多添加 ${MAX_REFERENCE_IMAGES} 张参考图` : "添加参考图"}
                    >
                        <span className="flex flex-col items-center gap-1 opacity-70">
                            <Plus className="size-4" />
                            添加
                        </span>
                    </button>
                </div>

                <div className="relative grid">
                    {showAtImageMenu ? (
                        <div style={{ left: `${menuLeft}px` }} className="absolute bottom-full z-50 mb-2 w-64 overflow-hidden rounded-2xl border border-gray-200/70 bg-white/95 p-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
                            <div className="px-2 pb-1 pt-0.5 text-[11px] text-gray-400 dark:text-gray-500">选择引用素材</div>
                            <div className="max-h-56 overflow-y-auto">
                                {atMediaOptions.map((option, optionIndex) => (
                                    <button
                                        key={option.key}
                                        type="button"
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                            selectAtMediaOption(option);
                                        }}
                                        onMouseEnter={() => setAtImageMenuIndex(optionIndex)}
                                        className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition-colors ${
                                            optionIndex === atImageMenuIndex ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300" : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]"
                                        }`}
                                    >
                                        {option.kind === "image" ? <img src={option.image.dataUrl} alt={option.label} className="size-8 shrink-0 rounded-lg object-cover" /> : <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-500 dark:bg-blue-500/10 dark:text-blue-300"><AudioLines className="size-4" /></span>}
                                        <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                                        <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.08] dark:text-gray-400">{option.source}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    <div
                        ref={inputRef}
                        data-canvas-editor
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck={false}
                        className="thin-scrollbar col-start-1 row-start-1 max-h-44 min-h-[2rem] w-full select-text overflow-y-auto whitespace-pre-wrap break-words rounded-lg border-0 bg-transparent px-2 py-1.5 text-sm leading-5 outline-none"
                        style={{ color: theme.node.text }}
                        onInput={(event) => {
                            isUserInputRef.current = true;
                            if (isCanvasPromptImeEvent(isComposingRef.current, event.nativeEvent as InputEvent)) return;
                            const range = getContentEditableSelection(event.currentTarget);
                            setCursorPos(range.start);
                            syncMentionTagSelection(event.currentTarget);
                            updatePrompt(getContentEditablePlainText(event.currentTarget));
                            setAtImageMenuIndex(0);
                            setAtImageMenuDismissed(false);
                        }}
                        onCompositionStart={() => {
                            if (compositionSyncTimerRef.current !== null) window.clearTimeout(compositionSyncTimerRef.current);
                            compositionSyncTimerRef.current = null;
                            isComposingRef.current = true;
                            isUserInputRef.current = true;
                        }}
                        onCompositionEnd={finishPromptComposition}
                        onBlur={() => {
                            if (isComposingRef.current) finishPromptComposition();
                        }}
                        onSelect={(event) => {
                            const range = getContentEditableSelection(event.currentTarget);
                            setCursorPos(range.start);
                            syncMentionTagSelection(event.currentTarget);
                            setAtImageMenuIndex(0);
                            setAtImageMenuDismissed(false);
                        }}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePromptPaste}
                        onCopy={handlePromptCopy}
                        onClick={(event) => {
                            const el = inputRef.current;
                            if (!el) return;
                            const target = event.target as HTMLElement;
                            if (target.classList.contains("mention-tag")) {
                                const sel = window.getSelection();
                                if (sel) {
                                    const range = document.createRange();
                                    range.selectNode(target);
                                    sel.removeAllRanges();
                                    sel.addRange(range);
                                    syncMentionTagSelection(el);
                                }
                                return;
                            }
                            syncMentionTagSelection(el);
                        }}
                        aria-label={getPromptPlaceholder(mode, hasImageContent, hasTextContent)}
                    />
                    {!prompt ? <div className="pointer-events-none col-start-1 row-start-1 px-2 py-1.5 text-sm leading-5" style={{ color: theme.node.placeholder }}>{getPromptPlaceholder(mode, hasImageContent, hasTextContent)}</div> : null}
                </div>
            </div>

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} options={modelOptions} onChange={(model) => onConfigChange(node.id, { model })} onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} options={modelOptions} onChange={(model) => onConfigChange(node.id, { model })} onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, key === "videoSeconds" ? { seconds: value } : { [key]: value })} />
                        </>
                    ) : (
                        <ModelPicker config={config} value={config.model} options={modelOptions} onChange={(model) => onConfigChange(node.id, { model })} onMissingConfig={() => openConfigDialog(true)} />
                    )}
                </div>
                <Button type="primary" className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3" disabled={isRunning || !canSubmitPrompt} onClick={submit} aria-label="生成">
                    <span className="flex items-center gap-1.5">
                        {mode === "image" && (
                            imageCostText ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums">{imageCostText}</span>
                            ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums">
                                    <CreditSymbol />
                                    {credits.toLocaleString()}
                                </span>
                            )
                        )}
                        {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                    </span>
                </Button>
            </div>

            <CanvasReferencePickerModal
                open={referencePickerOpen}
                nodeId={node.id}
                canvasNodes={canvasNodes}
                selectedReferences={referenceImages}
                onUpload={() => fileInputRef.current?.click()}
                onSelect={addReferenceImages}
                onClose={() => setReferencePickerOpen(false)}
            />
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferenceFiles(event.target.files);
                    event.target.value = "";
                }}
            />
            <input
                ref={replaceFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleReplaceFileUpload}
            />
        </div>
    );
}

function CanvasReferencePickerModal({ open, nodeId, canvasNodes, selectedReferences, onUpload, onSelect, onClose }: { open: boolean; nodeId: string; canvasNodes: CanvasNodeData[]; selectedReferences: CanvasReferenceImage[]; onUpload: () => void; onSelect: (images: CanvasReferenceImage[]) => void; onClose: () => void }) {
    const [activeTab, setActiveTab] = useState<"canvas" | "assets">("canvas");
    const [keyword, setKeyword] = useState("");
    const [categoryFilter, setCategoryFilter] = useState<"all" | ReferencePickerCategory>("all");
    const assets = useAssetStore((state) => state.assets);
    const selectedKeys = useMemo(() => new Set(selectedReferences.map(referenceIdentity)), [selectedReferences]);

    useEffect(() => {
        if (!open) return;
        setActiveTab("canvas");
        setKeyword("");
        setCategoryFilter("all");
    }, [open]);

    const canvasImages = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return canvasNodes
            .filter((item) => item.id !== nodeId && item.type === CanvasNodeType.Image && item.metadata?.content)
            .filter((item) => categoryFilter === "all" || getCanvasImageCategory(item) === categoryFilter)
            .filter((item) => !query || [item.title, item.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query));
    }, [canvasNodes, categoryFilter, keyword, nodeId]);

    const imageAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets
            .filter((asset) => asset.kind === "image")
            .filter((asset) => categoryFilter === "all" || getAssetCategory(asset) === categoryFilter)
            .filter((asset) => !query || [asset.title, asset.source, asset.note, ...(asset.tags || [])].filter(Boolean).join(" ").toLowerCase().includes(query));
    }, [assets, categoryFilter, keyword]);

    const selectCanvasNode = (canvasNode: CanvasNodeData) => {
        if (!canvasNode.metadata?.content) return;
        void createReferenceFromSource({
            name: `${canvasNode.title || canvasNode.id}.png`,
            type: canvasNode.metadata.mimeType || "image/png",
            dataUrl: canvasNode.metadata.content,
            storageKey: canvasNode.metadata.storageKey,
            width: canvasNode.metadata.naturalWidth,
            height: canvasNode.metadata.naturalHeight,
            bytes: canvasNode.metadata.bytes,
            mimeType: canvasNode.metadata.mimeType,
        }).then((reference) => onSelect([reference]));
    };

    const selectAsset = (asset: Asset) => {
        if (asset.kind !== "image") return;
        void createReferenceFromSource({
            name: `${asset.title || asset.id}.png`,
            type: asset.data.mimeType || "image/png",
            dataUrl: asset.data.dataUrl,
            storageKey: asset.data.storageKey,
            width: asset.data.width,
            height: asset.data.height,
            bytes: asset.data.bytes,
            mimeType: asset.data.mimeType,
        }).then((reference) => onSelect([reference]));
    };

    return (
        <Modal title={null} open={open} footer={null} width={1080} centered destroyOnHidden onCancel={onClose} className="canvas-reference-picker-modal" styles={{ body: { padding: 0 } }}>
            <div className="min-h-[560px] rounded-2xl border border-stone-200 bg-white p-4 text-stone-900 shadow-2xl dark:border-white/[0.08] dark:bg-[#181818] dark:text-stone-100">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <Tabs
                        activeKey={activeTab}
                        onChange={(key) => setActiveTab(key as "canvas" | "assets")}
                        items={[
                            { key: "canvas", label: "画布" },
                            { key: "assets", label: "我的素材" },
                        ]}
                    />
                    <Input className="max-w-64 rounded-full" prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索图片" value={keyword} allowClear onChange={(event) => setKeyword(event.target.value)} />
                </div>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    {referenceCategoryOptions.map((option) => (
                        <Tag.CheckableTag key={option.value} checked={categoryFilter === option.value} className={`prompt-filter-tag ${categoryFilter === option.value ? "is-active" : ""}`} onChange={() => setCategoryFilter(option.value)}>
                            {option.label}
                        </Tag.CheckableTag>
                    ))}
                </div>
                {activeTab === "canvas" ? (
                    <ReferenceGrid empty="当前画布没有可用图片">
                        <ReferenceUploadCard onUpload={onUpload} />
                        {canvasImages.map((item) => {
                            const reference = {
                                id: `canvas-ref-${item.id}`,
                                name: item.title,
                                type: item.metadata?.mimeType || "image/png",
                                dataUrl: item.metadata?.content || "",
                                storageKey: item.metadata?.storageKey,
                            };
                            return <ReferenceImageCard key={item.id} title={item.title} imageUrl={item.metadata?.content || ""} source={getCanvasImageCategory(item)} selected={selectedKeys.has(referenceIdentity(reference))} onClick={() => selectCanvasNode(item)} />;
                        })}
                    </ReferenceGrid>
                ) : (
                    <ReferenceGrid empty="我的素材里没有可用图片">
                        <ReferenceUploadCard onUpload={onUpload} />
                        {imageAssets.map((asset) => {
                            const reference = {
                                id: `asset-ref-${asset.id}`,
                                name: asset.title,
                                type: asset.data.mimeType || "image/png",
                                dataUrl: asset.data.dataUrl,
                                storageKey: asset.data.storageKey,
                            };
                            return <ReferenceImageCard key={asset.id} title={asset.title} imageUrl={asset.coverUrl || asset.data.dataUrl} source={getAssetCategory(asset)} selected={selectedKeys.has(referenceIdentity(reference))} onClick={() => selectAsset(asset)} />;
                        })}
                    </ReferenceGrid>
                )}
            </div>
        </Modal>
    );
}

function ReferenceGrid({ empty, children }: { empty: string; children: ReactNode }) {
    const items = Children.toArray(children).filter(Boolean);
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items}
            {items.length <= 1 ? (
                <div className="col-span-full">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} className="py-12" />
                </div>
            ) : null}
        </div>
    );
}

function ReferenceUploadCard({ onUpload }: { onUpload: () => void }) {
    return (
        <button type="button" className="group min-h-44 overflow-hidden rounded-xl border border-dashed border-stone-300 bg-stone-100/70 text-stone-500 transition hover:border-blue-300 hover:bg-blue-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-stone-400 dark:hover:border-blue-400/40 dark:hover:bg-blue-500/10" onClick={onUpload}>
            <span className="flex h-full min-h-44 flex-col items-center justify-center gap-2">
                <Upload className="size-7 opacity-70 transition group-hover:opacity-100" />
                <span className="text-sm font-medium">本地上传</span>
            </span>
        </button>
    );
}

function ReferenceImageCard({ title, imageUrl, source, selected, onClick }: { title: string; imageUrl: string; source: string; selected: boolean; onClick: () => void }) {
    return (
        <button type="button" className="group relative overflow-hidden rounded-xl border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-stone-500" onClick={onClick}>
            <div className="relative aspect-[4/3] bg-stone-100 dark:bg-stone-900">
                <img src={imageUrl} alt={title} className="h-full w-full object-cover" />
                {selected ? <span className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-medium text-white">已引用</span> : null}
                <div className="pointer-events-none absolute inset-0 bg-stone-950/0 transition group-hover:bg-stone-950/25" />
            </div>
            <div className="space-y-1 p-3">
                <Tag className="m-0 text-[10px]">{source}</Tag>
                <div className="truncate text-sm font-medium text-stone-800 dark:text-stone-100">{title || "未命名图片"}</div>
            </div>
        </button>
    );
}

function getPromptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    return mode === "video" ? "描述要生成的视频内容" : mode === "image" ? (hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容") : hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function getCanvasImageCategory(node: CanvasNodeData): ReferencePickerCategory {
    const value = node.metadata?.assetCategory;
    return normalizeAssetTag(value);
}

function getAssetCategory(asset: Asset): ReferencePickerCategory {
    return getAssetTag(asset);
}

async function createCanvasReferenceImage(file: File, nodeId: string): Promise<CanvasReferenceImage> {
    const uploaded = await uploadImage(file);
    const inputImage = await createInputImageFromFile(file);
    const id = inputImage?.id || `upload-ref-${nodeId}-${Date.now()}`;
    if (inputImage) primeImageCache(id, inputImage.dataUrl);
    return {
        id,
        name: file.name || `reference-${Date.now()}.png`,
        type: uploaded.mimeType || file.type || "image/png",
        dataUrl: inputImage?.dataUrl || uploaded.url,
        url: uploaded.url,
        storageKey: uploaded.storageKey,
        width: uploaded.width,
        height: uploaded.height,
        bytes: uploaded.bytes,
        mimeType: uploaded.mimeType || file.type || "image/png",
    };
}

async function createReferenceFromSource(source: { name: string; type: string; dataUrl: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string }): Promise<CanvasReferenceImage> {
    const displayUrl = await imageToDataUrl({ dataUrl: source.dataUrl, storageKey: source.storageKey });
    const dataUrl = displayUrl.startsWith("data:image/") ? displayUrl : await blobUrlToDataUrl(displayUrl);
    const id = await storeImage(dataUrl, "upload");
    primeImageCache(id, dataUrl);
    return {
        id,
        name: source.name,
        type: source.mimeType || source.type || "image/png",
        dataUrl,
        url: displayUrl,
        storageKey: source.storageKey,
        width: source.width,
        height: source.height,
        bytes: source.bytes,
        mimeType: source.mimeType || source.type || "image/png",
    };
}

async function cacheReferenceForSharedTools(image: CanvasReferenceImage): Promise<InputImage | null> {
    try {
        const displayUrl = await imageToDataUrl(image);
        const dataUrl = displayUrl.startsWith("data:image/") ? displayUrl : await blobUrlToDataUrl(displayUrl);
        const id = await storeImage(dataUrl, "upload");
        primeImageCache(id, dataUrl);
        return { id, dataUrl };
    } catch {
        return null;
    }
}

function blobUrlToDataUrl(url: string): Promise<string> {
    return fetch(url)
        .then((response) => response.blob())
        .then(
            (blob) =>
                new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result || ""));
                    reader.onerror = () => reject(new Error("读取图片失败"));
                    reader.readAsDataURL(blob);
                }),
        );
}

function referenceIdentity(image: Pick<CanvasReferenceImage, "id" | "dataUrl" | "storageKey" | "url">) {
    return image.storageKey || image.url || image.dataUrl || image.id;
}

function referenceToInputImage(image: Pick<CanvasReferenceImage, "id" | "dataUrl" | "url">): InputImage {
    return { id: image.id, dataUrl: image.dataUrl || image.url || "" };
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode, activeProfileId: string): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : globalConfig.textModel;
    const model = node.metadata?.model || defaultModel || globalConfig.model || defaultConfig.model;
    const resolvedModel = mode === "image" ? normalizeImageModelForProfile(model, activeProfileId) : model;
    return {
        ...globalConfig,
        model: resolvedModel,
        imageModel: mode === "image" ? resolvedModel : globalConfig.imageModel,
        textModel: mode === "text" ? resolvedModel : globalConfig.textModel,
        videoModel: mode === "video" ? resolvedModel : globalConfig.videoModel,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: normalizeImageSizeForProfile(node.metadata?.size || globalConfig.size || defaultConfig.size, activeProfileId),
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        count: String(node.metadata?.count || (mode === "image" ? 1 : globalConfig.count) || defaultConfig.count),
    };
}

function getMentionTagTextLength(el: Element) {
    return el.textContent?.length ?? 0;
}

function getNodeVisibleTextLength(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
    if (node instanceof HTMLElement && node.classList.contains("mention-tag")) return getMentionTagTextLength(node);
    return Array.from(node.childNodes).reduce((sum, child) => sum + getNodeVisibleTextLength(child), 0);
}

function getVisibleOffsetBeforeNode(root: HTMLElement, target: Node): number {
    let offset = 0;
    let found = false;
    const walk = (node: Node) => {
        if (found) return;
        if (node === target) {
            found = true;
            return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            offset += node.textContent?.length ?? 0;
            return;
        }
        if (node instanceof HTMLElement && node.classList.contains("mention-tag")) {
            offset += getMentionTagTextLength(node);
            return;
        }
        node.childNodes.forEach(walk);
    };
    root.childNodes.forEach(walk);
    return offset;
}

function getMentionTagForBoundary(root: HTMLElement, container: Node) {
    const el = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
    const tag = el?.closest(".mention-tag");
    return tag && root.contains(tag) ? tag : null;
}

function getBoundaryOffsetInMention(tag: Element, container: Node, offset: number) {
    try {
        const range = document.createRange();
        range.selectNodeContents(tag);
        range.setEnd(container, offset);
        return range.toString().length;
    } catch {
        return getMentionTagTextLength(tag);
    }
}

function getContentEditableBoundaryOffset(root: HTMLElement, container: Node, offset: number, edge: "start" | "end", collapsed: boolean) {
    if (container === root) {
        let visibleOffset = 0;
        for (const child of Array.from(root.childNodes).slice(0, offset)) visibleOffset += getNodeVisibleTextLength(child);
        return visibleOffset;
    }
    if (!root.contains(container)) {
        const position = root.compareDocumentPosition(container);
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 0;
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return root.textContent?.length ?? 0;
        if (container.contains(root)) {
            const children = Array.from(container.childNodes);
            const rootIndex = children.indexOf(root as unknown as ChildNode);
            return offset <= rootIndex ? 0 : root.textContent?.length ?? 0;
        }
        return edge === "start" ? 0 : root.textContent?.length ?? 0;
    }
    const mentionTag = getMentionTagForBoundary(root, container);
    if (mentionTag) {
        const mentionStart = getVisibleOffsetBeforeNode(root, mentionTag);
        const mentionLength = getMentionTagTextLength(mentionTag);
        if (!collapsed) return edge === "start" ? mentionStart : mentionStart + mentionLength;
        const mentionOffset = getBoundaryOffsetInMention(mentionTag, container, offset);
        return mentionStart + (mentionOffset < mentionLength / 2 ? 0 : mentionLength);
    }
    if (container.nodeType === Node.TEXT_NODE) return getVisibleOffsetBeforeNode(root, container) + offset;
    const element = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : null;
    if (element) {
        let visibleOffset = element === root ? 0 : getVisibleOffsetBeforeNode(root, element);
        for (const child of Array.from(element.childNodes).slice(0, offset)) visibleOffset += getNodeVisibleTextLength(child);
        return visibleOffset;
    }
    return root.textContent?.length ?? 0;
}

function getContentEditableCursor(el: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return el.textContent?.length ?? 0;
    try {
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) return el.textContent?.length ?? 0;
        return getContentEditableBoundaryOffset(el, range.startContainer, range.startOffset, "start", range.collapsed);
    } catch {
        return el.textContent?.length ?? 0;
    }
}

function getContentEditableSelection(el: HTMLElement): { start: number; end: number } {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
        const end = el.textContent?.length ?? 0;
        return { start: end, end };
    }
    try {
        const range = sel.getRangeAt(0);
        const start = getContentEditableBoundaryOffset(el, range.startContainer, range.startOffset, "start", range.collapsed);
        const end = range.collapsed ? start : getContentEditableBoundaryOffset(el, range.endContainer, range.endOffset, "end", false);
        return { start, end };
    } catch {
        const end = el.textContent?.length ?? 0;
        return { start: end, end };
    }
}

function getContentEditablePlainText(el: HTMLElement): string {
    let text = "";
    const appendNodeText = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent ?? "";
            return;
        }
        if (node instanceof HTMLElement && node.classList.contains("mention-tag")) {
            text += node.dataset.mentionText ?? node.textContent ?? "";
            return;
        }
        node.childNodes.forEach(appendNodeText);
    };
    el.childNodes.forEach(appendNodeText);
    return text.replace(/\r\n?/g, "\n");
}

function contentEditableMentionsMatch(el: HTMLElement, expected: Array<{ text: string; mentionText: string }>) {
    const current = Array.from(el.querySelectorAll<HTMLElement>(".mention-tag")).map((tag) => ({
        text: tag.textContent ?? "",
        mentionText: tag.dataset.mentionText ?? tag.textContent ?? "",
    }));
    return current.length === expected.length && current.every((item, index) => item.text === expected[index]?.text && item.mentionText === expected[index]?.mentionText);
}

function escapeHtml(text: string) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getMentionTagHtml(text: string) {
    return `<span contenteditable="false" class="mention-tag" data-mention-text="${escapeHtml(getSelectedTextMentionLabel(text))}">${escapeHtml(text)}</span>`;
}

function syncMentionTagSelection(el: HTMLElement) {
    const tags = el.querySelectorAll<HTMLElement>(".mention-tag");
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
        tags.forEach((tag) => tag.classList.remove("selected"));
        return;
    }
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
        tags.forEach((tag) => tag.classList.remove("selected"));
        return;
    }
    tags.forEach((tag) => {
        let isSelected = false;
        try {
            isSelected = range.intersectsNode(tag);
        } catch {
            isSelected = false;
        }
        tag.classList.toggle("selected", isSelected);
    });
}

function setContentEditableCursor(el: HTMLElement, offset: number) {
    const sel = window.getSelection();
    if (!sel) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node: Text | null = null;
    while (walker.nextNode()) {
        node = walker.currentNode as Text;
        const mentionTag = node.parentElement?.closest(".mention-tag");
        if (mentionTag) {
            if (remaining <= node.length) {
                const range = document.createRange();
                if (remaining < node.length / 2) range.setStartBefore(mentionTag);
                else range.setStartAfter(mentionTag);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
                return;
            }
            remaining -= node.length;
            continue;
        }
        if (remaining <= node.length) {
            const range = document.createRange();
            range.setStart(node, remaining);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
        }
        remaining -= node.length;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
}

function setContentEditableSelection(el: HTMLElement, start: number, end: number) {
    const sel = window.getSelection();
    if (!sel) return;
    const locate = (offset: number) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let remaining = offset;
        let lastText: Text | null = null;
        while (walker.nextNode()) {
            const text = walker.currentNode as Text;
            lastText = text;
            if (remaining <= text.length) return { node: text, offset: remaining };
            remaining -= text.length;
        }
        return lastText ? { node: lastText, offset: lastText.length } : { node: el, offset: el.childNodes.length };
    };
    const startPoint = locate(start);
    const endPoint = locate(end);
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    sel.removeAllRanges();
    sel.addRange(range);
}
