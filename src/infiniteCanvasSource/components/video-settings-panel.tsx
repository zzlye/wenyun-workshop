"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";
import { CANVAS_VIDEO_MIN_SECONDS, CANVAS_VIDEO_MAX_SECONDS, CANVAS_VIDEO_RESOLUTIONS, CANVAS_VIDEO_SECONDS, normalizeCanvasVideoAspectRatio, normalizeCanvasVideoDuration, normalizeCanvasVideoResolution, normalizeCanvasVideoModel } from "../../lib/videoModel";

const VIDEO_SIZE_OPTIONS = [
    { value: "1280x720", label: "16:9 横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "9:16 竖屏", width: 720, height: 1280 },
    { value: "1024x768", label: "4:3 横屏", width: 1024, height: 768 },
    { value: "768x1024", label: "3:4 竖屏", width: 768, height: 1024 },
    { value: "1024x1024", label: "1:1 方形", width: 1024, height: 1024 },
    { value: "1680x720", label: "21:9 宽屏", width: 1680, height: 720 },
];

// 音频生成字段由请求层携带，设置面板只呈现用户可选的画面参数。
type VideoSettingsValues = Pick<AiConfig, "vquality" | "size" | "videoSeconds">;
export type VideoSettingsChange = <K extends keyof VideoSettingsValues>(key: K, value: VideoSettingsValues[K]) => void;

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: VideoSettingsChange;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const videoModel = normalizeCanvasVideoModel(config.videoModel || config.model);
    const seconds = normalizeVideoSecondsForModel(config.videoSeconds, videoModel);
    const size = normalizeVideoSizeValue(config.size, videoModel);
    const resolution = normalizeVideoResolutionValue(config.vquality, videoModel);

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
                    <div className="grid grid-cols-3 gap-2.5">
                        {CANVAS_VIDEO_RESOLUTIONS.map((value) => (
                            <OptionPill key={value} selected={resolution === value} theme={theme} onClick={() => onConfigChange("vquality", value)}>
                                {value}p
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="画面比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {VIDEO_SIZE_OPTIONS.map((item) => (
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
                    <DurationInput value={seconds} onChange={(value) => onConfigChange("videoSeconds", value)} />
                    <div className="grid grid-cols-2 gap-2.5">
                        {CANVAS_VIDEO_SECONDS.map((value) => (
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

export function videoResolutionLabel(value: string, model?: string) {
    return `${normalizeVideoResolutionValue(value, model)}p`;
}

export function videoSizeLabel(value: string, model?: string) {
    const size = normalizeVideoSizeValue(value, model);
    return VIDEO_SIZE_OPTIONS.find((item) => item.value === size)?.label || "16:9 横屏";
}

export function videoSecondsLabel(value: string, model?: string) {
    return `${normalizeVideoSecondsForModel(value, model)}s`;
}

export function normalizeVideoSizeValue(value: string, _model?: string) {
    const ratio = normalizeCanvasVideoAspectRatio(value);
    if (ratio === "9:16") return "720x1280";
    if (ratio === "4:3") return "1024x768";
    if (ratio === "3:4") return "768x1024";
    if (ratio === "1:1") return "1024x1024";
    if (ratio === "21:9") return "1680x720";
    return "1280x720";
}

export function normalizeVideoResolutionValue(value: string, _model?: string) {
    return normalizeCanvasVideoResolution(value);
}

export function normalizeVideoSecondsForModel(value: string, _model?: string) {
    return String(normalizeCanvasVideoDuration(value));
}

function DurationInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    // 编辑期间允许暂时清空，失焦时再校验，避免输入两位秒数时被立即改回默认值。
    return <input aria-label="视频时长（秒）" type="number" min={CANVAS_VIDEO_MIN_SECONDS} max={CANVAS_VIDEO_MAX_SECONDS} step={1} value={draft}
        className="h-9 w-full rounded-lg border border-current bg-transparent px-3 text-sm"
        onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            // 有效秒数立即保存，避免点击面板外生成按钮时先卸载输入框而漏掉失焦更新。
            const numeric = Number(next);
            if (next.trim() && Number.isInteger(numeric) && numeric >= CANVAS_VIDEO_MIN_SECONDS && numeric <= CANVAS_VIDEO_MAX_SECONDS) onChange(next);
        }}
        onBlur={() => {
            const next = String(normalizeCanvasVideoDuration(draft));
            setDraft(next);
            onChange(next);
        }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" aria-pressed={selected} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
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
