"use client";

import { useEffect, useMemo, useState } from "react";

import { getImageModelOptionsForProfile } from "../../../../../lib/apiProfiles";
import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";
import type { CanvasGenerationMode } from "../types";
import { parseModelListPayload } from "../../../../../lib/modelList";
import { CANVAS_VIDEO_MODEL } from "../../../../../lib/videoModel";

type ModelOption = string | { value: string; label: string };
type ExternalModelTarget = "text";

// 缓存同一套 API 地址和 Key 的模型列表，避免每个节点重复请求 /models。
const modelOptionsCache = new Map<string, string[]>();

export function useCanvasModelOptions(config: AiConfig, mode: CanvasGenerationMode, activeProfileId: string): ModelOption[] | undefined {
    const currentModel = mode === "image" ? config.imageModel || config.model : mode === "video" ? config.videoModel || config.model : config.textModel || config.model;
    const source = mode === "text" ? getExternalModelSource(config) : null;
    const [externalOptions, setExternalOptions] = useState<string[]>(() => uniqueModels([currentModel]));

    useEffect(() => {
        if (!source) return;
        const fallback = uniqueModels([source.model]);
        if (!source.baseUrl.trim()) {
            setExternalOptions(fallback);
            return;
        }

        const cacheKey = `${source.target}:${source.baseUrl}:${source.apiKey}`;
        const cached = modelOptionsCache.get(cacheKey);
        if (cached?.length) {
            setExternalOptions(uniqueModels([source.model, ...cached]));
            return;
        }

        // 读取失败时保留当前模型，保证已填写的模型不会从下拉里消失。
        let cancelled = false;
        setExternalOptions(fallback);
        void fetchExternalModelOptions(source.baseUrl, source.apiKey).then((models) => {
            if (cancelled) return;
            modelOptionsCache.set(cacheKey, models);
            setExternalOptions(uniqueModels([source.model, ...models]));
        });

        return () => {
            cancelled = true;
        };
    }, [source?.apiKey, source?.baseUrl, source?.model, source?.target]);

    return useMemo(() => {
        if (mode === "image") return getImageModelOptionsForProfile(activeProfileId);
        if (mode === "video") return [CANVAS_VIDEO_MODEL];
        return externalOptions.length ? externalOptions : currentModel ? [currentModel] : undefined;
    }, [activeProfileId, currentModel, externalOptions, mode]);
}

function getExternalModelSource(config: AiConfig) {
    return {
        target: "text" as ExternalModelTarget,
        baseUrl: config.textBaseUrl.trim(),
        apiKey: config.textApiKey.trim(),
        model: config.textModel || config.model,
    };
}

async function fetchExternalModelOptions(baseUrl: string, apiKey: string) {
    try {
        const response = await fetch(buildApiUrl(baseUrl, "/models"), {
            headers: apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined,
            cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) return [];
        return parseModelListPayload(payload);
    } catch {
        return [];
    }
}

function uniqueModels(models: Array<string | undefined>) {
    return Array.from(new Set(models.map((model) => model?.trim() || "").filter(Boolean)));
}
