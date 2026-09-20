import { VideoSettingsPanel } from "../infiniteCanvasSource/components/video-settings-panel";
import { useConfigStore } from "../infiniteCanvasSource/stores/use-config-store";
import { useThemeStore } from "../infiniteCanvasSource/stores/use-theme-store";
import { canvasThemes } from "../infiniteCanvasSource/lib/canvas-theme";

// 全局默认参数与画布节点使用同一表单、同一能力缓存。
export default function GlobalVideoSettings({ model, apiKey, proxy }: { model: string; apiKey: string; proxy: boolean }) {
    const config = useConfigStore((s) => s.config);
    const update = useConfigStore((s) => s.updateConfig);
    const theme = useThemeStore((s) => s.theme);
    return (
        <VideoSettingsPanel
            config={{ ...config, videoModel: model, videoApiKey: apiKey, videoApiProxy: proxy }}
            onConfigChange={(key, value) => update(key, value)}
            theme={canvasThemes[theme]}
            className="max-w-xl space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700"
        />
    );
}
