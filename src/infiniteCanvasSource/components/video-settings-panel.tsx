"use client";

import { useEffect, type ReactNode } from "react";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";
import { CANVAS_VIDEO_25_SECONDS, CANVAS_VIDEO_SECONDS, getCanvasVideoResolution, isCanvasVideo25Model, normalizeCanvasVideoModel } from "../../lib/videoModel";

const VIDEO_SIZE_OPTIONS = [
    { value: "1280x720", label: "16:9 横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "9:16 竖屏", width: 720, height: 1280 },
    { value: "1024x768", label: "4:3 横屏", width: 1024, height: 768 },
    { value: "768x1024", label: "3:4 竖屏", width: 768, height: 1024 },
    { value: "1024x1024", label: "1:1 方形", width: 1024, height: 1024 },
    { value: "1680x720", label: "21:9 宽屏", width: 1680, height: 720 },
];

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const videoModel = normalizeCanvasVideoModel(config.videoModel || config.model);
    const seconds = normalizeVideoSecondsForModel(config.videoSeconds, videoModel);
    const size = normalizeVideoSizeValue(config.size, videoModel);
    const resolution = normalizeVideoResolutionValue(config.vquality, videoModel);
    const sizeOptions = getVideoSizeOptions(videoModel);
    const secondsOptions = isCanvasVideo25Model(videoModel) ? CANVAS_VIDEO_25_SECONDS : CANVAS_VIDEO_SECONDS;

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
                {showTitle ? (
                    <div>
                        <div className="text-lg font-semibold">视频设置</div>
                        <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>{videoModel}</div>
                    </div>
                ) : null}
                <SettingGroup title="清晰度" color={theme.node.muted}>
                    <div className="grid grid-cols-1 gap-2.5">
                        <div className="flex h-9 items-center justify-center rounded-full border px-2 text-sm" style={{ borderColor: theme.node.text, color: theme.node.text }}>
                            {resolution}p
                        </div>
                    </div>
                </SettingGroup>
                <SettingGroup title="画面比例" color={theme.node.muted}>
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
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="秒数" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {secondsOptions.map((value) => (
                            <OptionPill key={value} selected={seconds === value} theme={theme} onClick={() => onConfigChange("videoSeconds", value)}>
                                {value}s
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(_value: string, model?: string) {
    return `${normalizeVideoResolutionValue(_value, model)}p`;
}

export function videoSizeLabel(value: string, model?: string) {
    const normalizedModel = normalizeCanvasVideoModel(model);
    const size = normalizeVideoSizeValue(value, normalizedModel);
    return getVideoSizeOptions(normalizedModel).find((item) => item.value === size)?.label || "16:9 横屏";
}

export function videoSecondsLabel(value: string, model?: string) {
    return `${normalizeVideoSecondsForModel(value, model)}s`;
}

export function normalizeVideoSizeValue(value: string, model?: string) {
    const normalizedModel = normalizeCanvasVideoModel(model);
    const ratio = readAspectRatio(value);
    if (isCanvasVideo25Model(normalizedModel) && !["16:9", "9:16", "1:1"].includes(ratio)) return "1280x720";
    if (ratio === "9:16") return "720x1280";
    if (ratio === "4:3") return "1024x768";
    if (ratio === "3:4") return "768x1024";
    if (ratio === "1:1") return "1024x1024";
    if (ratio === "21:9") return "1680x720";
    return "1280x720";
}

export function normalizeVideoResolutionValue(_value: string, model?: string) {
    return getCanvasVideoResolution(normalizeCanvasVideoModel(model));
}

export function normalizeVideoSecondsForModel(value: string, model?: string) {
    const max = isCanvasVideo25Model(normalizeCanvasVideoModel(model)) ? 29 : 15;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "10";
    return String(Math.min(max, Math.max(4, Math.round(numeric))));
}

function getVideoSizeOptions(model: string) {
    return isCanvasVideo25Model(model) ? VIDEO_SIZE_OPTIONS.filter((item) => ["1280x720", "720x1280", "1024x1024"].includes(item.value)) : VIDEO_SIZE_OPTIONS;
}

function readAspectRatio(value: string) {
    const trimmed = (value || "").trim();
    if (["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"].includes(trimmed)) return trimmed;
    if (!/^\d+x\d+$/.test(trimmed)) return "16:9";

    const [width, height] = trimmed.split("x").map(Number);
    if (!width || !height) return "16:9";
    if (Math.abs(width - height) / Math.max(width, height) < 0.02) return "1:1";
    const ratio = width / height;
    if (ratio >= 2) return "21:9";
    if (ratio >= 1.5) return "16:9";
    if (ratio >= 1.15) return "4:3";
    if (ratio <= 0.65) return "9:16";
    if (ratio <= 0.85) return "3:4";
    return "16:9";
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
            <div className="text-xs font-medium" style={{ color }}>{title}</div>
            {children}
        </div>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}
