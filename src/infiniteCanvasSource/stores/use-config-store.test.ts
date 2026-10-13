// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { defaultConfig, useConfigStore } from './use-config-store';

describe('首次启动的画布配置', () => {
    it('没有历史配置时可以完成恢复，不会把空配置当作读取失败', async () => {
        const current = useConfigStore.getState();
        const merged = useConfigStore.persist.getOptions().merge!(undefined, current);
        expect(merged.config).toEqual(defaultConfig);
        await useConfigStore.persist.rehydrate();
        expect(useConfigStore.persist.hasHydrated()).toBe(true);
    });
});
