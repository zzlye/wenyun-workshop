"use client";

import { useEffect, type ReactNode } from "react";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

const defaultResolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];

const hdResolutionOptions = [
    { value: "720", label: "720p" },
    { value: "1080", label: "1080p" },
];

const grok720ResolutionOptions = [
    { value: "720", label: "720p" },
];

const grok1080ResolutionOptions = [
    { value: "1080", label: "1080p" },
];

const defaultSizeOptions = [
    { value: "1280x720", label: "横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "竖屏", width: 720, height: 1280 },
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1792x1024", label: "宽屏", width: 1792, height: 1024 },
    { value: "1024x1792", label: "长图", width: 1024, height: 1792 },
    { value: "auto", label: "auto", width: 0, height: 0 },
];

const standardLandscapeSizeOptions = [
    { value: "1280x720", label: "横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "竖屏", width: 720, height: 1280 },
];

const klingSizeOptions = [
    ...standardLandscapeSizeOptions,
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1920x1080", label: "1080 横屏", width: 1920, height: 1080 },
    { value: "1080x1920", label: "1080 竖屏", width: 1080, height: 1920 },
    { value: "1080x1080", label: "1080 方形", width: 1080, height: 1080 },
];

const soraV3SizeOptions = [
    ...standardLandscapeSizeOptions,
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1680x720", label: "21:9", width: 1680, height: 720 },
    { value: "1024x768", label: "4:3", width: 1024, height: 768 },
    { value: "768x1024", label: "3:4", width: 768, height: 1024 },
];

const grokImagineSizeOptions = [
    { value: "1280x720", label: "16:9", width: 1280, height: 720 },
    { value: "720x1280", label: "9:16", width: 720, height: 1280 },
    { value: "1024x1024", label: "1:1", width: 1024, height: 1024 },
    { value: "1024x768", label: "4:3", width: 1024, height: 768 },
    { value: "768x1024", label: "3:4", width: 768, height: 1024 },
    { value: "1536x1024", label: "3:2", width: 1536, height: 1024 },
    { value: "1024x1536", label: "2:3", width: 1024, height: 1536 },
];

const defaultSecondOptions = [6, 10, 12, 16, 20];
const sora2SecondOptions = [4, 8, 12];
const soraV3SecondOptions = [4, 6, 8, 10, 12, 15];
const veo31FastSecondOptions = [4, 6, 8];
const klingSecondOptions = [3, 5, 10, 15];
const grokImagineSecondOptions = [3, 6, 10, 15];

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const videoModel = config.videoModel || config.model;
    const resolutionOptions = getVideoResolutionOptions(videoModel);
    const sizeOptions = getVideoSizeOptions(videoModel);
    const secondOptions = getVideoSecondOptions(videoModel);
    const seconds = normalizeVideoSecondsForModel(config.videoSeconds || "6", videoModel);
    const size = normalizeVideoSizeValue(config.size, videoModel);
    const dimensions = readSizeDimensions(size);
    const resolution = normalizeVideoResolutionValue(config.vquality, videoModel);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    useEffect(() => {
        if ((config.videoSeconds || "") === seconds) return;
        onConfigChange("videoSeconds", seconds);
    }, [config.videoSeconds, onConfigChange, seconds]);

    useEffect(() => {
        if ((config.size || "") === size) return;
        onConfigChange("size", size);
    }, [config.size, onConfigChange, size]);

    useEffect(() => {
        if ((config.vquality || "") === resolution) return;
        onConfigChange("vquality", resolution);
    }, [config.vquality, onConfigChange, resolution]);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="清晰度" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                        <ResolutionInput value={resolution} theme={theme} onChange={(value) => onConfigChange("vquality", value)} />
                    </div>
                </SettingGroup>
                <SettingGroup title="尺寸" color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                        {sizeOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[78px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: size === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                                {item.value === "auto" ? null : (
                                    <span className="text-[11px] leading-none opacity-55">
                                        {item.value}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="秒数" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {secondOptions.map((value) => (
                            <OptionPill key={value} selected={seconds === String(value)} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </OptionPill>
                        ))}
                        {allowsCustomVideoSeconds(videoModel) ? <NumberInput value={seconds} min={getVideoSecondsRange(videoModel).min} max={getVideoSecondsRange(videoModel).max} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} /> : null}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string, model = "") {
    return `${normalizeVideoResolutionValue(value, model)}p`;
}

export function videoSizeLabel(value: string, model = "") {
    const size = normalizeVideoSizeValue(value, model);
    return getVideoSizeOptions(model).find((item) => item.value === size)?.label || defaultSizeOptions.find((item) => item.value === size)?.label || size;
}

export function videoSecondsLabel(value: string, model = "") {
    return `${normalizeVideoSecondsForModel(value || "6", model)}s`;
}

export function normalizeVideoSizeValue(value: string, model = "") {
    if (value === "auto") return isSora2VideoModel(model) || isVeo31FastVideoModel(model) || isKlingVideoModel(model) || isSoraV3VideoModel(model) || isBafangGrokImagineVideo15Model(model) ? "1280x720" : "auto";
    const size = /^\d+x\d+$/.test(value || "") ? value : ratioToVideoSize(value);
    const aspectRatio = readAspectRatio(size);
    if (isSora2VideoModel(model) || isVeo31FastVideoModel(model)) return aspectRatio === "9:16" ? "720x1280" : "1280x720";
    if (isKlingVideoModel(model)) {
        if (aspectRatio === "1:1") return "1024x1024";
        return aspectRatio === "9:16" ? "720x1280" : "1280x720";
    }
    if (isBafangGrokImagineVideo15Model(model)) return aspectRatioToGrokImagineSize(aspectRatio);
    if (isSoraV3VideoModel(model)) {
        if (aspectRatio === "1:1") return "1024x1024";
        if (aspectRatio === "21:9") return "1680x720";
        if (aspectRatio === "4:3") return "1024x768";
        if (aspectRatio === "3:4") return "768x1024";
        return aspectRatio === "9:16" ? "720x1280" : "1280x720";
    }
    return size;
}

function ratioToVideoSize(value: string) {
    if (value === "1:1") return "1024x1024";
    if (value === "21:9") return "1680x720";
    if (value === "4:3") return "1024x768";
    if (value === "3:4") return "768x1024";
    if (value === "3:2") return "1536x1024";
    if (value === "2:3") return "1024x1536";
    if (["9:16", "2:3"].includes(value)) return "720x1280";
    return "1280x720";
}

function aspectRatioToGrokImagineSize(aspectRatio: string) {
    if (aspectRatio === "1:1") return "1024x1024";
    if (aspectRatio === "9:16") return "720x1280";
    if (aspectRatio === "4:3") return "1024x768";
    if (aspectRatio === "3:4") return "768x1024";
    if (aspectRatio === "3:2") return "1536x1024";
    if (aspectRatio === "2:3") return "1024x1536";
    return "1280x720";
}

export function normalizeVideoResolutionValue(value: string, model = "") {
    if (isBafangGrokImagineVideo15Model(model)) return /1080p$/i.test(model.trim()) ? "1080" : "720";
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    const resolution = value.replace(/p$/i, "") || "720";
    if (isSora2VideoModel(model)) return "720";
    if (isSoraV3VideoModel(model)) return resolution === "480" ? "480" : "720";
    if (isKlingVideoModel(model) || isVeo31FastVideoModel(model)) return resolution === "1080" ? "1080" : "720";
    return resolution;
}

export function normalizeVideoSecondsForModel(value: string, model = "") {
    const seconds = Math.floor(Number(value) || 6);
    if (isSora2VideoModel(model)) {
        if (seconds <= 4) return "4";
        if (seconds >= 12) return "12";
        return "8";
    }
    if (isSoraV3VideoModel(model)) return String(Math.max(4, Math.min(15, seconds)));
    if (isVeo31FastVideoModel(model)) {
        if (seconds <= 4) return "4";
        if (seconds >= 8) return "8";
        return "6";
    }
    if (isBafangGrokImagineVideo15Model(model)) return String(Math.max(1, Math.min(15, seconds)));
    if (isKlingVideoModel(model)) return String(Math.max(3, Math.min(15, seconds)));
    return String(Math.max(1, Math.min(20, seconds)));
}

function getVideoSecondOptions(model = "") {
    if (isSora2VideoModel(model)) return sora2SecondOptions;
    if (isSoraV3VideoModel(model)) return soraV3SecondOptions;
    if (isVeo31FastVideoModel(model)) return veo31FastSecondOptions;
    if (isBafangGrokImagineVideo15Model(model)) return grokImagineSecondOptions;
    if (isKlingVideoModel(model)) return klingSecondOptions;
    return defaultSecondOptions;
}

function getVideoSecondsRange(model = "") {
    if (isSoraV3VideoModel(model)) return { min: 4, max: 15 };
    if (isBafangGrokImagineVideo15Model(model)) return { min: 1, max: 15 };
    if (isKlingVideoModel(model)) return { min: 3, max: 15 };
    return { min: 1, max: 20 };
}

function allowsCustomVideoSeconds(model = "") {
    return !isSora2VideoModel(model) && !isVeo31FastVideoModel(model);
}

function getVideoResolutionOptions(model = "") {
    if (isBafangGrokImagineVideo15Model(model)) return /1080p$/i.test(model.trim()) ? grok1080ResolutionOptions : grok720ResolutionOptions;
    if (isKlingVideoModel(model) || isVeo31FastVideoModel(model)) return hdResolutionOptions;
    return defaultResolutionOptions;
}

function getVideoSizeOptions(model = "") {
    if (isSora2VideoModel(model) || isVeo31FastVideoModel(model)) return standardLandscapeSizeOptions;
    if (isKlingVideoModel(model)) return klingSizeOptions;
    if (isBafangGrokImagineVideo15Model(model)) return grokImagineSizeOptions;
    if (isSoraV3VideoModel(model)) return soraV3SizeOptions;
    return defaultSizeOptions;
}

function readAspectRatio(value: string) {
    if (!/^\d+x\d+$/.test(value || "")) return "16:9";
    const [width, height] = value.split("x").map(Number);
    if (!width || !height) return "16:9";
    if (Math.abs(width - height) / Math.max(width, height) < 0.02) return "1:1";
    const ratio = width / height;
    if (Math.abs(ratio - 21 / 9) < 0.03) return "21:9";
    if (Math.abs(ratio - 16 / 9) < 0.03) return "16:9";
    if (Math.abs(ratio - 9 / 16) < 0.03) return "9:16";
    if (Math.abs(ratio - 4 / 3) < 0.03) return "4:3";
    if (Math.abs(ratio - 3 / 4) < 0.03) return "3:4";
    if (Math.abs(ratio - 3 / 2) < 0.03) return "3:2";
    if (Math.abs(ratio - 2 / 3) < 0.03) return "2:3";
    if (ratio >= 2) return "21:9";
    if (ratio >= 1.5) return "16:9";
    if (ratio >= 1.15) return "4:3";
    if (ratio <= 0.5) return "9:16";
    if (ratio <= 0.85) return "3:4";
    return "16:9";
}

function isBafangGrokImagineVideo15Model(model = "") {
    return /^grok-imagine-video-1\.5(?:-|$)/i.test(model.trim());
}

function isSora2VideoModel(model = "") {
    return /^sora-?2(?:-|$)/i.test(model.trim());
}

function isSoraV3VideoModel(model = "") {
    return /^sora-v3(?:-|$)/i.test(model.trim());
}

function isVeo31FastVideoModel(model = "") {
    return /^veo31-fast$/i.test(model.trim());
}

function isKlingVideoModel(model = "") {
    return /^kling-video(?:-|$)/i.test(model.trim());
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
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

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input type="number" min={1} className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function NumberInput({ value, min, max, theme, onChange }: { value: string; min: number; max: number; theme: CanvasTheme; onChange: (value: string) => void }) {
    return <input type="number" min={min} max={max} className="h-9 rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }} value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />;
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}
