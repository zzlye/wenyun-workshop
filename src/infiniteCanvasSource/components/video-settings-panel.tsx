"use client";

import { useState, type ReactNode } from "react";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";
import { useVideoCapabilities } from "../../hooks/useVideoCapabilities";
import {
    mergeVideoParameterDefinitions,
    videoSelectionError,
    type VideoParameterDefinition,
    type VideoSelection,
} from "../../lib/videoCapabilities";
import {
    CANVAS_VIDEO_RESOLUTIONS,
    CANVAS_VIDEO_SECONDS,
    CANVAS_VIDEO_ASPECT_RATIOS,
    normalizeCanvasVideoAspectRatio,
    normalizeCanvasVideoDuration,
    normalizeCanvasVideoResolution,
    normalizeCanvasVideoModel,
} from "../../lib/videoModel";

type VideoSettingsValues = Pick<
    AiConfig,
    "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoMode" | "videoExtraParameters"
>;
export type VideoSettingsChange = <K extends keyof VideoSettingsValues>(key: K, value: AiConfig[K]) => void;
export type VideoMediaCounts = Pick<VideoSelection, "imageCount" | "videoCount" | "audioCount">;
type Props = {
    config: AiConfig;
    onConfigChange: VideoSettingsChange;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    media?: VideoMediaCounts;
};

export function VideoSettingsPanel({
    config,
    onConfigChange,
    theme,
    media,
    showTitle = true,
    className = "w-[320px] max-w-full space-y-4 rounded-2xl px-1 py-0.5",
}: Props) {
    const model = normalizeCanvasVideoModel(config.videoModel || config.model);
    const query = useVideoCapabilities(config.videoApiKey, Boolean(config.videoApiProxy), model);
    const capability = query.data;
    const variants = capability?.configured ? capability.variants : [];
    const resolution = normalizeVideoResolutionValue(config.vquality);
    const resolutionValue = resolution === "4k" ? resolution : `${resolution}p`;
    const ratio = normalizeCanvasVideoAspectRatio(config.size);
    const selection: VideoSelection = {
        ...media,
        duration: normalizeCanvasVideoDuration(config.videoSeconds),
        resolution: resolutionValue,
        aspect_ratio: ratio,
        mode: config.videoMode === "auto" && !media ? undefined : config.videoMode,
        generate_audio: config.videoGenerateAudio ?? undefined,
        extra_parameters: config.videoExtraParameters,
    };
    const error = capability ? videoSelectionError(capability, selection) : null;
    const union = (values: string[][], fallback: readonly string[]) => Array.from(new Set(values.flat().length ? values.flat() : fallback));
    const resolutions = union(
        variants.map((v) => [...(v.resolutions ?? []), ...(v.combinations ?? []).flatMap((c) => c.resolutions ?? [])]),
        CANVAS_VIDEO_RESOLUTIONS.map((v) => `${v}p`),
    );
    const ratios = union(
        variants.map((v) => [...(v.aspect_ratios ?? []), ...(v.combinations ?? []).flatMap((c) => c.aspect_ratios ?? [])]),
        CANVAS_VIDEO_ASPECT_RATIOS,
    );
    const durations = union(
        variants.map((v) => (v.duration.values ?? []).map(String)),
        CANVAS_VIDEO_SECONDS,
    );
    const definitions = mergeVideoParameterDefinitions(variants);
    // 当前值失效时保留并提示，允许逐项修正；有效组合仅开放仍有渠道支持的选项。
    const unavailable = (change: Partial<VideoSelection>) =>
        Boolean(capability && !error && videoSelectionError(capability, { ...selection, ...change }));
    const inputClass = "h-9 w-full min-w-0 rounded-lg border border-current bg-transparent px-2 text-sm";
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(e) => e.stopPropagation()}>
                {showTitle && (
                    <div>
                        <div className="text-lg font-semibold">视频设置</div>
                        <div className="mt-1 break-all text-xs" style={{ color: theme.node.muted }}>
                            {model}
                        </div>
                    </div>
                )}
                {query.isFetching && (
                    <p className="text-xs" role="status">
                        正在读取模型选项…
                    </p>
                )}
                {query.isError && (
                    <p className="text-xs" role="alert">
                        模型选项读取失败，已保留输入。
                        <button type="button" onClick={() => void query.refetch()} className="underline">
                            重新读取
                        </button>
                    </p>
                )}
                {capability && !capability.configured && (
                    <p className="text-xs" style={{ color: theme.node.muted }}>
                        模型能力未配置，使用基础选项。
                    </p>
                )}
                {error && (
                    <p role="alert" className="break-words text-xs text-amber-600 dark:text-amber-400">
                        当前选择无兼容渠道：{error}。请调整下方选项。
                    </p>
                )}
                <Group title="生成模式">
                    <select
                        aria-label="生成模式"
                        className={inputClass}
                        value={config.videoMode ?? "auto"}
                        onChange={(e) => onConfigChange("videoMode", e.target.value as AiConfig["videoMode"])}
                    >
                        <option value="auto">自动（保留原有素材用途）</option>
                        <option value="text" disabled={unavailable({ mode: "text" })}>
                            文生视频
                        </option>
                        <option value="references" disabled={unavailable({ mode: "references" })}>
                            多参考素材
                        </option>
                        <option value="frames" disabled={unavailable({ mode: "frames" })}>
                            首尾帧
                        </option>
                    </select>
                    {config.videoMode === "frames" && (
                        <p className="text-xs" style={{ color: theme.node.muted }}>
                            第一张图片作为首帧，第二张作为尾帧；在参考素材中调整顺序。
                        </p>
                    )}
                </Group>
                <Group title="清晰度">
                    <div className="grid grid-cols-3 gap-2">
                        {union([resolutions, [resolutionValue]], []).map((v) => (
                            <Pill
                                key={v}
                                selected={v === resolutionValue}
                                disabled={unavailable({ resolution: v })}
                                theme={theme}
                                onClick={() => onConfigChange("vquality", normalizeCanvasVideoResolution(v))}
                            >
                                {v.toUpperCase()}
                            </Pill>
                        ))}
                    </div>
                </Group>
                <Group title="画面比例">
                    <div className="grid grid-cols-3 gap-2">
                        {union([ratios, [ratio]], []).map((v) => (
                            <Pill
                                key={v}
                                selected={v === ratio}
                                disabled={unavailable({ aspect_ratio: v })}
                                theme={theme}
                                onClick={() => onConfigChange("size", normalizeVideoSizeValue(v))}
                            >
                                {v}
                            </Pill>
                        ))}
                    </div>
                </Group>
                <Group title="秒数">
                    <input
                        aria-label="视频时长（秒）"
                        type="number"
                        min={1}
                        max={3600}
                        step={1}
                        value={config.videoSeconds}
                        className={inputClass}
                        onChange={(e) => onConfigChange("videoSeconds", e.target.value)}
                    />
                    <div className="grid grid-cols-3 gap-2">
                        {durations.map((v) => (
                            <Pill
                                key={v}
                                selected={config.videoSeconds === v}
                                disabled={unavailable({ duration: Number(v) })}
                                theme={theme}
                                onClick={() => onConfigChange("videoSeconds", v)}
                            >
                                {v}s
                            </Pill>
                        ))}
                    </div>
                    {variants.length > 0 && (
                        <p className="text-xs" style={{ color: theme.node.muted }}>
                            {Array.from(
                                new Set(
                                    variants.map((v) =>
                                        v.duration.values?.length
                                            ? `${v.duration.values.join("、")} 秒`
                                            : `${v.duration.min ?? 1}–${v.duration.max ?? 3600} 秒`,
                                    ),
                                ),
                            ).join(" / ")}
                        </p>
                    )}
                </Group>
                {(variants.some((v) => v.generate_audio) || config.videoGenerateAudio != null) && (
                    <Group title="生成音频">
                        <select
                            aria-label="生成音频"
                            className={inputClass}
                            value={config.videoGenerateAudio == null ? "" : String(config.videoGenerateAudio)}
                            onChange={(e) => onConfigChange("videoGenerateAudio", e.target.value === "" ? null : e.target.value === "true")}
                        >
                            <option value="">未指定</option>
                            <option value="true" disabled={unavailable({ generate_audio: true })}>
                                开启
                            </option>
                            <option value="false" disabled={unavailable({ generate_audio: false })}>
                                关闭
                            </option>
                        </select>
                    </Group>
                )}
                {Object.keys(config.videoExtraParameters ?? {})
                    .filter((key) => !definitions.some((p) => p.key === key))
                    .map((key) => (
                        <p key={key} className="text-xs">
                            参数 {key} 不适用于当前模型。
                            <button
                                type="button"
                                className="underline"
                                onClick={() => {
                                    const next = { ...config.videoExtraParameters };
                                    delete next[key];
                                    onConfigChange("videoExtraParameters", next);
                                }}
                            >
                                移除此参数
                            </button>
                        </p>
                    ))}
                {definitions.length > 0 && (
                    <details className="space-y-3">
                        <summary className="cursor-pointer text-sm">更多参数</summary>
                        {definitions.map((p) => (
                            <Group key={p.key} title={p.definitions[0].label || p.key}>
                                <ParameterVariants
                                    definitions={p.definitions}
                                    value={config.videoExtraParameters?.[p.key]}
                                    className={inputClass}
                                    unavailable={(value) =>
                                        unavailable({ extra_parameters: { ...config.videoExtraParameters, [p.key]: value } })
                                    }
                                    onChange={(v) => {
                                        const next = { ...config.videoExtraParameters };
                                        if (v === undefined) delete next[p.key];
                                        else next[p.key] = v;
                                        onConfigChange("videoExtraParameters", next);
                                    }}
                                />
                            </Group>
                        ))}
                    </details>
                )}
            </div>
        </ImageSettingsTheme>
    );
}

// 不同渠道同名字段可能类型不同，由用户选择输入类型，切换控件不改写已有值。
function ParameterVariants({
    definitions,
    ...props
}: {
    definitions: VideoParameterDefinition[];
    value: unknown;
    onChange: (v: unknown) => void;
    className: string;
    unavailable: (v: unknown) => boolean;
}) {
    const [chosenType, setChosenType] = useState("");
    const matching = definitions.find((d) => (d.type === "integer" ? "number" : d.type) === typeof props.value);
    const definition = definitions.find((d) => d.type === chosenType) ?? matching ?? definitions[0];
    const names = { string: "文本", integer: "整数", number: "数字", boolean: "布尔" };
    return (
        <div className="space-y-2">
            {definitions.length > 1 && (
                <select
                    aria-label={`${definition.label || definition.key}输入类型`}
                    className={props.className}
                    value={definition.type}
                    onChange={(e) => setChosenType(e.target.value)}
                >
                    {definitions.map((d) => (
                        <option key={d.type} value={d.type}>
                            {names[d.type]}
                        </option>
                    ))}
                </select>
            )}
            <ParameterInput definition={definition} {...props} />
        </div>
    );
}

function ParameterInput({
    definition: p,
    value,
    onChange,
    className,
    unavailable,
}: {
    definition: VideoParameterDefinition;
    value: unknown;
    onChange: (v: unknown) => void;
    className: string;
    unavailable: (v: unknown) => boolean;
}) {
    if (p.options?.length || p.type === "boolean") {
        const options = p.options?.length ? [...p.options] : [true, false];
        if (value !== undefined && !options.includes(value)) options.push(value);
        return (
            <select
                aria-label={p.label || p.key}
                className={className}
                value={value === undefined ? "" : JSON.stringify(value)}
                onChange={(e) => onChange(e.target.value === "" ? undefined : JSON.parse(e.target.value))}
            >
                <option value="">{p.default === undefined ? "未指定" : `默认：${String(p.default)}`}</option>
                {options.map((v) => (
                    <option key={JSON.stringify(v)} value={JSON.stringify(v)} disabled={unavailable(v)}>
                        {v === true ? "开启" : v === false ? "关闭" : String(v)}
                    </option>
                ))}
            </select>
        );
    }
    return (
        <input
            aria-label={p.label || p.key}
            className={className}
            type={p.type === "string" ? "text" : "number"}
            min={p.min}
            max={p.max}
            step={p.type === "integer" ? 1 : "any"}
            placeholder={p.default === undefined ? "未指定" : String(p.default)}
            value={value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? undefined : p.type === "string" ? e.target.value : Number(e.target.value))}
        />
    );
}

export function videoResolutionLabel(value: string, model?: string) {
    const v = normalizeVideoResolutionValue(value, model);
    return v === "4k" ? "4K" : `${v}p`;
}
export function videoSizeLabel(value: string, _model?: string) {
    return normalizeCanvasVideoAspectRatio(value);
}
export function videoSecondsLabel(value: string, model?: string) {
    return `${normalizeVideoSecondsForModel(value, model)}s`;
}
export function normalizeVideoSizeValue(value: string, _model?: string) {
    const ratio = normalizeCanvasVideoAspectRatio(value);
    return (
        (
            {
                "16:9": "1280x720",
                "9:16": "720x1280",
                "4:3": "1024x768",
                "3:4": "768x1024",
                "1:1": "1024x1024",
                "21:9": "1680x720",
            } as Record<string, string>
        )[ratio] || ratio
    );
}
export function normalizeVideoResolutionValue(value: string, _model?: string) {
    return normalizeCanvasVideoResolution(value);
}
export function normalizeVideoSecondsForModel(value: string, _model?: string) {
    return String(normalizeCanvasVideoDuration(value));
}
function Pill({
    selected,
    disabled,
    theme,
    onClick,
    children,
}: {
    selected: boolean;
    disabled?: boolean;
    theme: CanvasTheme;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            className="h-9 min-w-0 rounded-xl border px-2 text-sm disabled:cursor-not-allowed disabled:opacity-35"
            style={{ borderColor: selected ? theme.node.text : theme.node.stroke }}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="text-xs font-medium">{title}</div>
            {children}
        </div>
    );
}
