"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { Button } from "antd";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { allowsCustomImageRatioForProfile, getActiveApiProfile, getImageSizeTiersForProfile, normalizeImageSizeForProfile, normalizeSettings, supportsExtendedImageQuality } from "../../../../../lib/apiProfiles";
import { calculateImageSize, normalizeImageSize, parseRatio, type SizeTier } from "../../../../../lib/size";
import { useStore } from "../../../../../store";
import { normalizeImageBackground, supportsTransparentImageBackground } from "../../../../../lib/modelPricing";
import { getBananaSizeConfig, resolveBananaSizePreset, type BananaSizeTier } from "../../../../../lib/bananaImageSize";

const ALL_TIERS: SizeTier[] = ["1K", "2K", "4K"];
const QUALITY_OPTIONS = [
    { value: "auto", label: "自动" },
    { value: "low", label: "低" },
    { value: "medium", label: "中" },
    { value: "high", label: "高" },
];
const RATIOS = [
    { label: "1:1", value: "1:1" },
    { label: "3:2", value: "3:2" },
    { label: "2:3", value: "2:3" },
    { label: "16:9", value: "16:9" },
    { label: "9:16", value: "9:16" },
    { label: "4:3", value: "4:3" },
    { label: "3:4", value: "3:4" },
    { label: "21:9", value: "21:9" },
];

type CanvasImageSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onMissingConfig?: () => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    autoAdjustOverflow?: boolean;
};

export function CanvasImageSettingsPopover({ config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft" }: CanvasImageSettingsPopoverProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const settings = useStore((state) => state.settings);
    const activeProfile = useMemo(() => getActiveApiProfile(normalizeSettings(settings)), [settings]);
    const imageModel = config.imageModel || config.model || activeProfile.model;
    const allowedTiers = useMemo(() => getImageSizeTiersForProfile(activeProfile.id, imageModel), [activeProfile.id, imageModel]);
    const qualityOptions = useMemo(() => supportsExtendedImageQuality(imageModel)
        ? [...QUALITY_OPTIONS, { value: "xhigh", label: "极高" }, { value: "max", label: "最大" }]
        : QUALITY_OPTIONS, [imageModel]);
    const allowCustomRatio = useMemo(() => allowsCustomImageRatioForProfile(activeProfile.id), [activeProfile.id]);
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = config.quality || "auto";
    const profileSize = getBananaSizeConfig(imageModel)
        ? config.size || "1024x1024"
        : normalizeImageSizeForProfile(normalizeImageSize(config.size || "1024x1024"), activeProfile.id, imageModel);
    const activeSize = resolveBananaSizePreset(imageModel, profileSize)?.size || profileSize;
    const normalizedConfig = useMemo(() => activeSize === config.size ? config : { ...config, size: activeSize }, [activeSize, config]);

    useEffect(() => {
        // 切换模型后清理旧模型遗留的质量参数，避免把 xhigh/max 发给不支持的模型。
        if (!qualityOptions.some((item) => item.value === (config.quality || "auto"))) {
            onConfigChange("quality", "auto");
        }
    }, [config.quality, imageModel, onConfigChange, qualityOptions]);

    const updateOpen = (nextOpen: boolean) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
    };

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            updateOpen(false);
        };

        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [open]);

    const panel = open && buttonRect ? <ImageSizePortal buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} config={normalizedConfig} allowedTiers={allowedTiers} qualityOptions={qualityOptions} allowCustomRatio={allowCustomRatio} onConfigChange={onConfigChange} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button size="small" type="text" className={buttonClassName || "!h-8 !max-w-[180px] !justify-start !rounded-full !px-2.5"} style={{ background: theme.node.fill, color: theme.node.text }} icon={<Settings2 className="size-3.5" />} onClick={() => updateOpen(!open)}>
                    <span className="truncate">
                        {activeSize} · {imageQualityLabel(quality)} · {count} 张
                    </span>
                </Button>
            </span>
            {panel}
        </>
    );
}

function ImageSizePortal({
    buttonRect,
    panelRef,
    placement,
    theme,
    config,
    allowedTiers,
    qualityOptions,
    allowCustomRatio,
    onConfigChange,
}: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasImageSettingsPopoverProps["placement"];
    theme: CanvasTheme;
    config: AiConfig;
    allowedTiers: SizeTier[];
    qualityOptions: Array<{ value: string; label: string }>;
    allowCustomRatio: boolean;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
}) {
    const width = Math.min(420, window.innerWidth - 24);
    const gap = 8;
    const margin = 12;
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const topPlacement = placement?.startsWith("top");
    const style = {
        position: "fixed",
        zIndex: 1200,
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap, maxHeight: Math.max(260, buttonRect.top - margin * 2) } : { top: buttonRect.bottom + gap, maxHeight: Math.max(260, window.innerHeight - buttonRect.bottom - margin * 2) }),
        background: theme === canvasThemes.dark ? "#17191f" : "#fff",
        border: `1px solid ${theme === canvasThemes.dark ? "#343841" : "#e5e7eb"}`,
        borderRadius: 18,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
        padding: 18,
        overflowY: "auto",
        color: theme.node.text,
    } as const;

    return createPortal(
        <div
            ref={panelRef}
            className="canvas-image-settings-popover"
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <CanvasImageSizePanel config={config} allowedTiers={allowedTiers} qualityOptions={qualityOptions} allowCustomRatio={allowCustomRatio} onConfigChange={onConfigChange} theme={theme} />
        </div>,
        document.body,
    );
}

export function CanvasImageSizePanel({ config, allowedTiers, qualityOptions, allowCustomRatio, onConfigChange, theme }: { config: AiConfig; allowedTiers: SizeTier[]; qualityOptions: Array<{ value: string; label: string }>; allowCustomRatio: boolean; onConfigChange: (key: keyof AiConfig, value: string) => void; theme: CanvasTheme }) {
    const imageModel = config.imageModel || config.model;
    const bananaConfig = getBananaSizeConfig(imageModel);
    const tiers = bananaConfig?.tiers ?? (allowedTiers.length ? allowedTiers : ALL_TIERS);
    const ratios = bananaConfig?.ratios.map((value) => ({ value, label: value })) ?? RATIOS;
    const customRatioAllowed = allowCustomRatio && !bananaConfig;
    const tierKey = tiers.join("|");
    const currentPreset = useMemo(() => bananaConfig
        ? resolveBananaSizePreset(imageModel, config.size || "1024x1024")
        : findPresetForSize(config.size || "1024x1024", allowedTiers), [bananaConfig, imageModel, config.size, tierKey]);
    const currentCustomRatio = useMemo(() => readRatioFromSize(config.size || ""), [config.size]);
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const [tier, setTier] = useState<BananaSizeTier>(currentPreset?.tier || tiers[0] || "1K");
    const [ratio, setRatio] = useState(currentPreset?.ratio || (customRatioAllowed && currentCustomRatio ? "custom" : "1:1"));
    const [customRatio, setCustomRatio] = useState(currentPreset?.ratio || currentCustomRatio || "16:9");
    const activeRatio = ratio === "custom" ? customRatio : ratio;
    const previewSize = useMemo(() => {
        if (bananaConfig) return bananaConfig.presets.find((preset) => preset.tier === tier && preset.ratio === activeRatio)?.size || "";
        if (tier === "512px") return "";
        const size = calculateImageSize(tier, activeRatio);
        return size ? normalizeImageSize(size) : "";
    }, [activeRatio, bananaConfig, tier]);
    const customRatioValid = ratio !== "custom" || Boolean(parseRatio(customRatio));

    const applySize = (nextTier: BananaSizeTier, nextRatio: string) => {
        const size = bananaConfig
            ? bananaConfig.presets.find((preset) => preset.tier === nextTier && preset.ratio === nextRatio)?.size
            : nextTier === "512px" ? "" : calculateImageSize(nextTier, nextRatio);
        if (size) onConfigChange("size", bananaConfig ? size : normalizeImageSize(size));
    };

    useEffect(() => {
        // 外部切换模型或尺寸时，以新模型的合法预设同步面板，不触发额外的尺寸提交。
        if (currentPreset) {
            setTier(currentPreset.tier);
            setRatio(currentPreset.ratio);
            return;
        }
        if (bananaConfig) return;
        setTier((previous) => tiers.includes(previous) ? previous : tiers[tiers.length - 1] || "1K");
        setRatio(customRatioAllowed && currentCustomRatio ? "custom" : "1:1");
        if (currentCustomRatio) setCustomRatio(currentCustomRatio);
    }, [imageModel, config.size, tierKey]);

    useEffect(() => {
        if (customRatioAllowed || ratio !== "custom") return;
        const nextRatio = currentPreset?.ratio || ratios[0].value;
        setRatio(nextRatio);
        if (!bananaConfig) applySize(tier, nextRatio);
    }, [customRatioAllowed, ratio, tier]);

    const selectTier = (nextTier: BananaSizeTier) => {
        setTier(nextTier);
        applySize(nextTier, activeRatio);
    };

    const selectRatio = (nextRatio: string) => {
        setRatio(nextRatio);
        applySize(tier, nextRatio);
    };

    const selectCustomRatio = () => {
        setRatio("custom");
        applySize(tier, customRatio);
    };

    const updateCustomRatio = (value: string) => {
        setCustomRatio(value);
        if (parseRatio(value)) applySize(tier, value);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className="space-y-4" style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                <div className="text-lg font-semibold">图像设置</div>
                <SettingGroup title="品质" color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {qualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={(config.quality || "auto") === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="基准分辨率" color={theme.node.muted}>
                    <div className={`grid gap-2.5 ${tiers.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
                        {tiers.map((item) => (
                            <OptionPill key={item} selected={tier === item} theme={theme} onClick={() => selectTier(item)}>
                                {item}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="图像比例" color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {ratios.map((item) => (
                            <RatioButton key={item.value} selected={ratio === item.value} theme={theme} label={item.label} value={item.value} onClick={() => selectRatio(item.value)} />
                        ))}
                        {customRatioAllowed ? (
                            <button
                                type="button"
                                className="col-span-4 h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
                                style={{ background: "transparent", borderColor: ratio === "custom" ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={selectCustomRatio}
                            >
                                自定义比例
                            </button>
                        ) : null}
                    </div>
                </SettingGroup>
                {supportsTransparentImageBackground(config.imageModel || config.model) && (
                    <SettingGroup title="背景" color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2.5">
                            {[{ value: "auto", label: "自动" }, { value: "opaque", label: "不透明" }, { value: "transparent", label: "透明背景" }].map((item) => (
                                <OptionPill key={item.value} selected={normalizeImageBackground(config.imageModel || config.model, config.imageBackground) === item.value} theme={theme} onClick={() => onConfigChange("imageBackground", item.value)}>
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                )}
                {customRatioAllowed && ratio === "custom" ? (
                    <SettingGroup title="自定义比例" color={theme.node.muted}>
                        <input
                            value={customRatio}
                            onChange={(event) => updateCustomRatio(event.target.value)}
                            placeholder="例如 5:4 / 2.39:1"
                            className="h-9 w-full rounded-xl border bg-transparent px-3 text-sm outline-none"
                            style={{ borderColor: customRatioValid ? theme.node.stroke : "#ef4444", color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                    </SettingGroup>
                ) : null}
                <SettingGroup title="生成张数" color={theme.node.muted}>
                    <div className="grid grid-cols-5 gap-2">
                        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                            <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                {value} 张
                            </OptionPill>
                        ))}
                    </div>
                    <CountInput value={count} max={15} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                </SettingGroup>
                <div className="rounded-2xl px-4 py-3" style={{ background: theme.node.fill, color: theme.node.text }}>
                    <div className="text-xs" style={{ color: theme.node.muted }}>
                        将使用
                    </div>
                    <div className="mt-1 font-mono text-lg font-semibold">{previewSize || "尺寸无效"}</div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" aria-pressed={selected} className="h-9 cursor-pointer rounded-lg border px-2 text-sm transition hover:opacity-80" style={{ background: selected ? "rgba(59,130,246,.12)" : "transparent", borderColor: selected ? "#3b82f6" : theme.node.stroke, color: selected ? "#60a5fa" : theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function RatioButton({ selected, theme, label, value, onClick }: { selected: boolean; theme: CanvasTheme; label: string; value: string; onClick: () => void }) {
    const [width, height] = value.split(":").map(Number);
    return (
        <button type="button" data-image-ratio={value} aria-pressed={selected} className="flex h-[64px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border text-sm transition hover:opacity-80" style={{ background: selected ? "rgba(59,130,246,.12)" : "transparent", borderColor: selected ? "#3b82f6" : theme.node.stroke, color: selected ? "#60a5fa" : theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            <RatioPreview width={width} height={height} color={selected ? "#60a5fa" : theme.node.text} />
            <span>{label}</span>
        </button>
    );
}

function RatioPreview({ width, height, color }: { width: number; height: number; color: string }) {
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="rounded-[3px] border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function findPresetForSize(size: string, tiers = ALL_TIERS) {
    const normalized = normalizeImageSize(size);
    // 画布尺寸选择沿用文运工坊的 1K/2K/4K 计算规则，但交互改为即时生效。
    for (const tier of tiers) {
        for (const ratio of RATIOS) {
            if (calculateImageSize(tier, ratio.value) === normalized) return { tier, ratio: ratio.value };
        }
    }
    return null;
}

function readRatioFromSize(size: string) {
    const match = size?.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/);
    if (!match) return "";
    return `${match[1]}:${match[2]}`;
}

function imageQualityLabel(value: string) {
    return ({ auto: "auto", high: "高", medium: "中", low: "低" } as Record<string, string>)[value] || value;
}
