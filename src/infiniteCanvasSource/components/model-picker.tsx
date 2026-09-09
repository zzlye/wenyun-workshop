// @ts-nocheck
"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AiConfig } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    options?: Array<string | { value: string; label: string }>;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, options: fixedOptions, className, fullWidth = false, placeholder = "选择模型", onMissingConfig }: ModelPickerProps) {
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(() => {
        if (fixedOptions?.length) {
            return fixedOptions
                .map((item) => (typeof item === "string" ? { value: item, label: item } : item))
                .filter((item) => item.value);
        }
        return Array.from(new Set([...(config.channelMode === "local" ? [value] : []), ...config.models].filter(Boolean))).map((model) => ({ value: model, label: model }));
    }, [config.channelMode, config.models, fixedOptions, value]);
    const current = value || "";
    const currentLabel = options.find((item) => item.value === current)?.label || current;

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") {
                    onMissingConfig?.();
                    return;
                }
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={currentLabel || placeholder}
            >
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{currentLabel || placeholder}</span>
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] !max-h-[min(28rem,calc(100vh-7rem))] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-border/70 p-1 shadow-xl !bg-white dark:!bg-gray-900 [&_[data-slot=select-viewport]]:!h-auto"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((item) => (
                        <SelectItem key={item.value} value={item.value} textValue={item.label}>
                            <ModelLabel model={item.value} label={item.label} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {config.channelMode === "remote" ? "暂无可用模型" : "请先到配置里拉取模型列表"}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function ModelLabel({ model, label = model }: { model: string; label?: string }) {
    return (
        <span className="flex min-w-0 items-center">
            <span className="truncate">{label}</span>
        </span>
    );
}
