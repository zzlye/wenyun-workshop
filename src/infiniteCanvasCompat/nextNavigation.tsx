import { createContext, useContext, useMemo, type ReactNode } from 'react'

export type CanvasRoute = {
  pathname: string
  params: Record<string, string>
}

type CanvasNavigationValue = CanvasRoute & {
  navigate: (href: string) => void
  backToHome: () => void
  openHome: () => void
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

// 使用 useMemo 缓存 router 对象，避免每次渲染返回新引用导致依赖了 router 的 useEffect 无限循环
export function useRouter() {
  const navigation = useCanvasNavigation()
  return useMemo(() => ({
    push: navigation.navigate,
    replace: navigation.navigate,
    back: navigation.backToHome,
    backToHome: navigation.backToHome,
    openHome: navigation.openHome,
    openSettings: navigation.openSettings,
    appearanceTheme: navigation.appearanceTheme,
    setAppearanceTheme: navigation.setAppearanceTheme,
    refresh: () => undefined,
    prefetch: async () => undefined,
  }), [navigation])
}

export function useParams<T extends Record<string, string> = Record<string, string>>() {
  return useCanvasNavigation().params as T
}

export function usePathname() {
  return useCanvasNavigation().pathname
}
