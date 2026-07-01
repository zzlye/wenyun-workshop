"use client";

import { Menu, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { useThemeStore } from "@/stores/use-theme-store";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useStore } from "../../../store";
import { getActiveApiProfile } from "../../../lib/apiProfiles";
import AccountBalanceBar from "../../../components/AccountBalanceBar";

export function AppTopNav() {
    const pathname = usePathname();
    const router = useRouter();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const fallbackTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const settings = useStore((state) => state.settings);
    const theme = router.appearanceTheme || fallbackTheme;
    const activeProfile = getActiveApiProfile(settings);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    return (
        <>
            {!hideHeader ? (
                <header className="safe-area-top sticky top-0 z-20 shrink-0 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/80">
                    <div className="safe-area-x safe-header-inner mx-auto flex max-w-7xl items-center justify-between gap-5">
                        <div className="flex min-w-0 flex-1 items-center pr-2">
                            <div className="flex shrink-0 items-center gap-3 text-sm font-semibold leading-none tracking-tight text-gray-800 dark:text-gray-100">
                                <span className="text-[17px] font-bold tracking-tight sm:text-lg">画布工坊</span>
                                <button type="button" className="canvas-return-button" onClick={() => router.back()} aria-label="返回文运工坊" title="返回文运工坊">
                                    <Sparkles className="size-4" />
                                    <span>文运工坊</span>
                                </button>
                            </div>

                            <button
                                type="button"
                                className="ml-3 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 md:hidden dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label="打开导航菜单"
                                title="导航菜单"
                            >
                                <Menu className="size-5" />
                            </button>
                        </div>

                        <div className="absolute left-1/2 top-1/2 hidden max-w-[48vw] -translate-x-1/2 -translate-y-1/2 sm:block">
                            <AccountBalanceBar activeProfile={activeProfile} showLoginButton />
                        </div>

                        <div className="flex min-w-0 items-center justify-end gap-1 justify-self-end whitespace-nowrap">
                            <AnimatedThemeToggler
                                theme={theme}
                                onThemeChange={(nextTheme) => {
                                    setTheme(nextTheme);
                                    router.setAppearanceTheme(nextTheme);
                                }}
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-600 shadow-none transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100 [&_svg]:h-5 [&_svg]:w-5"
                                aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                                title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                            />
                            <button
                                type="button"
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-600 shadow-none transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100 [&_svg]:h-5 [&_svg]:w-5"
                                onClick={() => router.openSettings()}
                                aria-label="配置"
                                title="配置"
                            >
                                <Settings className="size-5" />
                            </button>
                        </div>
                    </div>
                </header>
            ) : null}

            {!hideHeader ? (
                <nav className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
                    <div
                        className="pointer-events-auto flex max-w-full items-center gap-1 rounded-full p-1.5 shadow-[0_12px_34px_rgba(15,23,42,0.18)] dark:shadow-[0_12px_34px_rgba(0,0,0,0.52)]"
                        style={{
                            backgroundColor: theme === 'dark' ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.92)',
                            border: theme === 'dark' ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.08)',
                            backdropFilter: 'blur(24px) saturate(1.12)',
                            WebkitBackdropFilter: 'blur(24px) saturate(1.12)'
                        }}
                    >
                        {navigationTools.map((tool) => {
                            const Icon = tool.icon;
                            const active = tool.slug === activeToolSlug;
                            return (
                                <Link
                                    key={tool.slug}
                                    href={`/${tool.slug}`}
                                    className={cn(
                                        "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors",
                                        active
                                            ? "bg-blue-500 text-white"
                                            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-gray-100",
                                    )}
                                >
                                    <Icon className="size-4" />
                                    <span className="truncate">{tool.label}</span>
                                </Link>
                            );
                        })}
                    </div>
                </nav>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
        </>
    );
}
