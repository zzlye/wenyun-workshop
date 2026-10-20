import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'

export type CanvasRoute = {
  pathname: string
  params: Record<string, string>
}

type CanvasNavigationValue = CanvasRoute & {
  navigate: (href: string) => void
  backToHome: () => void
  openHome: () => void
  openWenyun: () => void
  openSettings: () => void
  appearanceTheme: 'light' | 'dark'
  setAppearanceTheme: (theme: 'light' | 'dark') => void
}

const CanvasNavigationContext = createContext<CanvasNavigationValue | null>(null)

export function CanvasNavigationProvider({
  children,
  value,
}: {
  children: ReactNode
  value: CanvasNavigationValue
}) {
  return <CanvasNavigationContext.Provider value={value}>{children}</CanvasNavigationContext.Provider>
}

function useCanvasNavigation() {
  const value = useContext(CanvasNavigationContext)
  if (!value) throw new Error('CanvasNavigationProvider is missing')
  return value
}

// 导航动作保持稳定；公告、余额与主题重绘不能触发画布重新读盘。
export function useRouter() {
  const navigation = useCanvasNavigation()
  const current = useRef(navigation)
  useLayoutEffect(() => { current.current = navigation }, [navigation])
  const actions = useMemo(() => ({
    push: (href: string) => current.current.navigate(href),
    replace: (href: string) => current.current.navigate(href),
    back: () => current.current.backToHome(),
    backToHome: () => current.current.backToHome(),
    openHome: () => current.current.openHome(),
    openWenyun: () => current.current.openWenyun(),
    openSettings: () => current.current.openSettings(),
    setAppearanceTheme: (theme: 'light' | 'dark') => current.current.setAppearanceTheme(theme),
    refresh: () => undefined,
    prefetch: async () => undefined,
  }), [])
  return useMemo(() => ({ ...actions, appearanceTheme: navigation.appearanceTheme }), [actions, navigation.appearanceTheme])
}

export function useParams<T extends Record<string, string> = Record<string, string>>() {
  return useCanvasNavigation().params as T
}

export function usePathname() {
  return useCanvasNavigation().pathname
}
