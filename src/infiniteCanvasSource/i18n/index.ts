import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import translations from './agent-zh.json';

// Agent 使用独立的中文资源，不改变西米露现有页面的语言和设置。
const agentI18n = i18n.createInstance();
agentI18n.use(initReactI18next).init({
    resources: { 'zh-CN': { translation: translations } },
    lng: 'zh-CN', fallbackLng: 'zh-CN', initAsync: false,
    interpolation: { escapeValue: false }, react: { useSuspense: false },
});
export default agentI18n;
