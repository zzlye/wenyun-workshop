import { useCallback, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// 复用西米露路由，阻止工具把网页导航到站外或不可用的上游页面。
export function resolveAgentPath(path: string) {
    if (path === '/image' || path === '/video') return '/wenyun';
    if (path === '/config') return '/settings';
    if (/^\/(?:canvas(?:\/[\w-]+)?|assets|wenyun|settings)?$/.test(path)) return path;
    throw new Error('不支持的页面地址');
}

export function useAgentNavigation() {
    const router = useRouter();
    const pathname = usePathname();
    const hash = window.location.hash;
    const search = window.location.search;
    const searchParams = useMemo(() => new URLSearchParams(search), [search]);
    const navigate = useCallback((path: string, options?: { replace?: boolean }) => {
        if (options?.replace) {
            const url = new URL(path, window.location.origin);
            if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) throw new Error('不支持的页面地址');
            window.history.replaceState(window.history.state, '', url);
            return;
        }
        const resolved = resolveAgentPath(path);
        if (resolved === '/wenyun') router.openWenyun();
        else if (resolved === '/settings') router.openSettings();
        else if (resolved === '/') router.openHome();
        else router.push(resolved);
    }, [router, pathname]);
    return { hash, searchParams, navigate };
}
