"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { apiGet } from "@/services/api/request";
import type { AdminPublicSettings } from "@/services/api/admin";

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    timeout: number;
    textVideoBaseUrl: string;
    textVideoApiKey: string;
    textVideoApiProxy: boolean;
    textVideoTimeout: number;
    textBaseUrl: string;
    textApiKey: string;
    textApiProxy: boolean;
    textTimeout: number;
    videoBaseUrl: string;
    videoApiKey: string;
    videoApiProxy: boolean;
    videoTimeout: number;
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    videoSeconds: string;
    vquality: string;
    systemPrompt: string;
    models: string[];
    quality: string;
    size: string;
    count: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export const DEFAULT_VIDEO_MODEL = "sora-2";
const DEFAULT_IMAGE_TIMEOUT = 600;
const DEFAULT_TEXT_VIDEO_TIMEOUT = 120;

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: "https://api.openai.com",
    apiKey: "",
    timeout: DEFAULT_IMAGE_TIMEOUT,
    textVideoBaseUrl: "",
    textVideoApiKey: "",
    textVideoApiProxy: false,
    textVideoTimeout: DEFAULT_TEXT_VIDEO_TIMEOUT,
    textBaseUrl: "",
    textApiKey: "",
    textApiProxy: false,
    textTimeout: DEFAULT_TEXT_VIDEO_TIMEOUT,
    videoBaseUrl: "",
    videoApiKey: "",
    videoApiProxy: false,
    videoTimeout: DEFAULT_TEXT_VIDEO_TIMEOUT,
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    videoModel: DEFAULT_VIDEO_MODEL,
    textModel: "gpt-5.5",
    videoSeconds: "6",
    vquality: "720",
    systemPrompt: "",
    models: [],
    quality: "auto",
    size: "1:1",
    count: "1",
};

type ConfigStore = {
    config: AiConfig;
    publicSettings: AdminPublicSettings | null;
    isPublicSettingsLoading: boolean;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    loadPublicSettings: () => Promise<void>;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function resolveEffectiveConfig(config: AiConfig, modelChannel: AdminPublicSettings["modelChannel"] | null) {
    const channelMode = modelChannel?.allowCustomChannel ? config.channelMode : "remote";
    if (channelMode === "local" || !modelChannel) return { ...config, channelMode };
    const models = modelChannel.availableModels;
    const fallbackModel = modelChannel.defaultModel || models[0] || "";
    return {
        ...config,
        channelMode,
        models,
        model: models.includes(config.model) ? config.model : fallbackModel,
        imageModel: models.includes(config.imageModel) ? config.imageModel : modelChannel.defaultImageModel || fallbackModel,
        videoModel: models.includes(config.videoModel) ? config.videoModel : modelChannel.defaultVideoModel || fallbackModel,
        textModel: models.includes(config.textModel) ? config.textModel : modelChannel.defaultTextModel || fallbackModel,
        systemPrompt: modelChannel.systemPrompt,
    };
}

function isAiConfigReady(config: AiConfig, model: string) {
    return Boolean(model.trim()) && (config.channelMode === "remote" || Boolean(config.baseUrl.trim() && config.apiKey.trim()));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            publicSettings: null,
            isPublicSettingsLoading: false,
            isConfigOpen: false,
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            loadPublicSettings: async () => {
                if (get().isPublicSettingsLoading) return;
                set({ isPublicSettingsLoading: true });
                try {
                    set({ publicSettings: await apiGet<AdminPublicSettings>("/api/settings") });
                } finally {
                    set({ isPublicSettingsLoading: false });
                }
            },
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config }),
            merge: (persisted, current) => {
                const config = { ...defaultConfig, ...((persisted as Partial<ConfigStore>).config || {}) };
                const legacyTextVideoBaseUrl = config.textVideoBaseUrl || "";
                const legacyTextVideoApiKey = config.textVideoApiKey || "";
                const legacyTextVideoApiProxy = Boolean(config.textVideoApiProxy);
                const legacyTextVideoTimeout = Number(config.textVideoTimeout) || DEFAULT_TEXT_VIDEO_TIMEOUT;
                return {
                    ...current,
                    config: {
                        ...config,
                        channelMode: config.channelMode || "remote",
                        imageModel: config.imageModel || config.model,
                        videoModel: normalizeVideoModel(config.videoModel),
                        textModel: config.textModel || config.model,
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        timeout: Number(config.timeout) || DEFAULT_IMAGE_TIMEOUT,
                        textVideoBaseUrl: legacyTextVideoBaseUrl,
                        textVideoApiKey: legacyTextVideoApiKey,
                        textVideoApiProxy: legacyTextVideoApiProxy,
                        textVideoTimeout: legacyTextVideoTimeout,
                        textBaseUrl: config.textBaseUrl || legacyTextVideoBaseUrl,
                        textApiKey: config.textApiKey || legacyTextVideoApiKey,
                        textApiProxy: typeof config.textApiProxy === "boolean" ? config.textApiProxy : legacyTextVideoApiProxy,
                        textTimeout: Number(config.textTimeout) || legacyTextVideoTimeout,
                        videoBaseUrl: config.videoBaseUrl || legacyTextVideoBaseUrl,
                        videoApiKey: config.videoApiKey || legacyTextVideoApiKey,
                        videoApiProxy: typeof config.videoApiProxy === "boolean" ? config.videoApiProxy : legacyTextVideoApiProxy,
                        videoTimeout: Number(config.videoTimeout) || legacyTextVideoTimeout,
                        quality: config.quality || defaultConfig.quality,
                    },
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    const modelChannel = useConfigStore((state) => state.publicSettings?.modelChannel || null);
    return useMemo(() => resolveEffectiveConfig(config, modelChannel), [config, modelChannel]);
}

export function buildApiUrl(baseUrl: string, path: string) {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    const apiBaseUrl = normalizedBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeVideoModel(model: string) {
    const value = model.trim();
    // 旧版原画布项目默认模型在当前中转站不可用，迁移到真实可拉取的视频模型。
    if (!value || /^grok-imagine-video$/i.test(value)) return DEFAULT_VIDEO_MODEL;
    return value;
}
