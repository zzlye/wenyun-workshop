const SORA_V3_MAPPED_MODELS = new Set([
    "seedream2.0-fast-720p",
    "seedream2.0-720p",
    "seedream2.0-1080p",
]);

export function isSoraV3VideoModel(model = "") {
    const normalized = model.trim().toLowerCase();
    // 映射模型仍需发送原始名称，这里只复用 Sora V3 的参数能力。
    return /^sora-v3(?:-|$)/i.test(normalized) || SORA_V3_MAPPED_MODELS.has(normalized);
}

export function getSoraV3FixedResolution(model = ""): "720p" | "1080p" | null {
    if (!isSoraV3VideoModel(model)) return null;
    return model.trim().toLowerCase().endsWith("-1080p") ? "1080p" : "720p";
}
