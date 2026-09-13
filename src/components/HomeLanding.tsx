import { useEffect, useRef, useState } from 'react'
import { Copy, Link, LogIn, Pause, Play, RefreshCw, Settings, X } from 'lucide-react'
import { LOCKED_WENYUN_PROFILE_ID, PIXIV_RANDOM_BACKGROUND_API_URL } from '../lib/apiProfiles'
import { useStore } from '../store'
import AccountLoginModal from './AccountLoginModal'
import { AnimatedThemeToggler } from '../infiniteCanvasSource/components/ui/animated-theme-toggler'

type HomeLandingProps = {
  onOpenGallery: () => void
  onOpenCanvas: () => void
  onOpenSettings: () => void
}

const BACKGROUND_ROTATION_MS = 90_000
const FALLBACK_BACKGROUND_URL = 'https://www.loliapi.com/acg/pc/'
const HOME_BACKGROUND_STORAGE_KEY = 'wenyun-home-background-url'

function findImageUrl(value: unknown): string | null {
  if (typeof value === 'string' && /^(https?:\/\/|\/i\/)/i.test(value.trim()) && !value.includes('/random')) return value.trim()
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findImageUrl(item)
      if (result) return result
    }
  } else {
    for (const item of Object.values(value)) {
      const result = findImageUrl(item)
      if (result) return result
    }
  }
  return null
}

function getSavedHomeBackgroundUrl() {
  try {
    return window.localStorage.getItem(HOME_BACKGROUND_STORAGE_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export default function HomeLanding({ onOpenGallery, onOpenCanvas, onOpenSettings }: HomeLandingProps) {
  const savedBackgroundUrl = getSavedHomeBackgroundUrl()
  const [backgroundUrls, setBackgroundUrls] = useState<[string, string]>(() => [savedBackgroundUrl, ''])
  const [activeBackgroundIndex, setActiveBackgroundIndex] = useState(0)
  const [isBackgroundReady, setIsBackgroundReady] = useState(Boolean(savedBackgroundUrl))
  const [isPaused, setIsPaused] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [showBackgroundUrl, setShowBackgroundUrl] = useState(false)
  const appearanceNightMode = useStore((state) => state.settings.appearanceNightMode)
  const setSettings = useStore((state) => state.setSettings)
  const activeBackgroundIndexRef = useRef(0)
  const backgroundRequestRef = useRef(0)
  const accountSession = useStore((state) => state.settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID] ?? null)

  const resolveFinalImageUrl = async (url: string) => {
    if (url.includes('/random')) {
      try {
        const apiUrl = `${url}${url.includes('?') ? '&' : '?'}format=simple_json&t=${Date.now()}`
        const response = await fetch(apiUrl, { cache: 'no-store' })
        const imageUrl = findImageUrl(await response.json())
        if (imageUrl) return imageUrl.startsWith('/') ? `https://i.mukyu.ru${imageUrl}` : imageUrl
      } catch {
        // JSON 接口不可用时继续尝试原图片地址。
      }
    }
    try {
      const response = await fetch(url, { cache: 'no-store', redirect: 'follow' })
      if (response.ok && response.url && !response.url.includes('/random')) return response.url
    } catch {
      // 图片请求本身仍可继续尝试，避免解析请求失败时主页完全没有背景。
    }
    return url
  }

  const loadBackground = (url: string) => {
    const requestId = backgroundRequestRef.current + 1
    backgroundRequestRef.current = requestId
    const preload = new Image()
    const loadResolvedImage = async () => {
      const resolvedUrl = await resolveFinalImageUrl(url)
      if (requestId !== backgroundRequestRef.current) return
      preload.src = resolvedUrl
    }
    preload.onload = () => {
      if (requestId !== backgroundRequestRef.current) return
      const nextIndex = activeBackgroundIndexRef.current === 0 ? 1 : 0
      setBackgroundUrls((current) => {
        const next = [...current] as [string, string]
        next[nextIndex] = preload.src
        return next
      })
      setIsBackgroundReady(true)
      // 主页背景单独保存，不能写入工坊共用的外观设置。
      try {
        window.localStorage.setItem(HOME_BACKGROUND_STORAGE_KEY, preload.src)
      } catch {
        // 浏览器禁止本地存储时仍保留当前页面的背景显示。
      }
      // 先让隐藏层完成一次渲染，再切换透明度，确保浏览器能执行交叉淡入淡出。
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          activeBackgroundIndexRef.current = nextIndex
          setActiveBackgroundIndex(nextIndex)
        })
      })
    }
    preload.onerror = () => {
      if (url !== FALLBACK_BACKGROUND_URL) {
        loadBackground(`${FALLBACK_BACKGROUND_URL}?home=${Date.now()}`)
        return
      }
    }
    void loadResolvedImage()
  }

  useEffect(() => {
    loadBackground(`${PIXIV_RANDOM_BACKGROUND_API_URL}&home=${Date.now()}`)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isPaused || !isBackgroundReady) return
    const timer = window.setInterval(() => {
      loadBackground(`${PIXIV_RANDOM_BACKGROUND_API_URL}&home=${Date.now()}`)
    }, BACKGROUND_ROTATION_MS)
    return () => window.clearInterval(timer)
  }, [isPaused, isBackgroundReady])

  const refreshBackground = () => {
    loadBackground(`${PIXIV_RANDOM_BACKGROUND_API_URL}&home=${Date.now()}`)
  }

  return (
    <div className="home-landing min-h-screen overflow-hidden bg-[#20242d] text-white">
      {backgroundUrls.map((url, index) => (
        <div
          key={index}
          aria-hidden
          className={`home-landing-background ${activeBackgroundIndex === index ? 'home-landing-background-active' : ''}`}
          style={{ backgroundImage: `url("${url}")` }}
        />
      ))}
      <div aria-hidden className="home-landing-shade" />
      <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10 sm:py-8">
        <div className="text-sm font-semibold tracking-[0.18em] text-white/90">
          文运生图
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="home-landing-icon-button" onClick={() => setShowLogin(true)} title={accountSession ? '账号' : '登录'}><LogIn className="size-4" /><span className="hidden sm:inline">{accountSession?.username || '登录'}</span></button>
          <AnimatedThemeToggler
            theme={appearanceNightMode ? 'dark' : 'light'}
            onThemeChange={(theme) => setSettings({ appearanceNightMode: theme === 'dark' })}
            className="home-landing-icon-button !h-9 !w-9 !justify-center !p-0"
            aria-label={appearanceNightMode ? '切换到白天模式' : '切换到夜间模式'}
            title={appearanceNightMode ? '切换到白天模式' : '切换到夜间模式'}
          />
          <button type="button" className="home-landing-icon-button" onClick={onOpenSettings} title="设置"><Settings className="size-4" /><span className="hidden sm:inline">设置</span></button>
        </div>
      </header>
      <main className="relative z-10 flex min-h-[calc(100vh-112px)] items-center px-4 pb-16 sm:px-8 sm:pb-20">
        <div className="w-full max-w-2xl px-2 py-8 sm:px-4 sm:py-10">
          <p className="mb-5 text-xs font-semibold tracking-[0.36em] text-white/70">CREATIVE IMAGE STUDIO</p>
          <h1 className="max-w-2xl text-5xl font-semibold tracking-[0.02em] text-white drop-shadow-2xl sm:text-7xl">文运生图</h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-white/70 sm:text-base">把灵感变成画面，从一个想法开始。</p>
          <nav className="mt-10 flex max-w-[300px] flex-col gap-3" aria-label="工作区">
            <button type="button" className="home-landing-entry home-landing-entry-primary" onClick={onOpenGallery}><span className="flex-1 text-left"><strong>文运工坊</strong><small>生成与管理图片</small></span><span className="text-xl text-gray-500">›</span></button>
            <button type="button" className="home-landing-entry" onClick={onOpenCanvas}><span className="flex-1 text-left"><strong>画布工坊</strong><small>组织画布创作</small></span><span className="text-xl text-gray-500">›</span></button>
          </nav>
        </div>
      </main>
      <div className="fixed bottom-5 right-5 z-20 flex items-center gap-2 sm:bottom-7 sm:right-7">
        <button type="button" className="home-landing-pause !px-2.5" onClick={() => setIsPaused((value) => !value)} aria-label={isPaused ? '继续轮播' : '暂停轮播'} title={isPaused ? '继续轮播' : '暂停轮播'}>{isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}</button>
        <button type="button" className="home-landing-pause !px-2.5" onClick={refreshBackground} aria-label="刷新背景" title="刷新背景"><RefreshCw className="size-3.5" /></button>
        <div className="relative">
          <button type="button" className="home-landing-pause !px-2.5" onClick={() => setShowBackgroundUrl((value) => !value)} aria-label="查看主页背景地址" title="查看主页背景地址"><Link className="size-3.5" /></button>
          {showBackgroundUrl && (
              <div className="absolute bottom-10 right-0 z-20 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-white/50 bg-white/90 p-3 text-gray-700 shadow-xl backdrop-blur-xl">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold">
                  <span>当前主页背景 URL</span>
                  <button type="button" onClick={() => setShowBackgroundUrl(false)} aria-label="关闭背景地址"><X className="size-3.5" /></button>
                </div>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all text-[11px] leading-5 text-gray-500">{backgroundUrls[activeBackgroundIndex] || '背景尚未加载'}</code>
                  <button type="button" className="shrink-0 rounded-md p-1.5 text-gray-500 transition hover:bg-gray-200" onClick={() => void navigator.clipboard?.writeText(backgroundUrls[activeBackgroundIndex] || '')} aria-label="复制背景地址" title="复制背景地址"><Copy className="size-3.5" /></button>
                </div>
              </div>
          )}
          </div>
      </div>
      <AccountLoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  )
}
