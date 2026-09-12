import { useEffect, useRef, useState } from 'react'
import { LogIn, Pause, Play, RefreshCw, Settings, Sparkles, WandSparkles } from 'lucide-react'
import { LOCKED_WENYUN_PROFILE_ID, PIXIV_RANDOM_BACKGROUND_API_URL } from '../lib/apiProfiles'
import { useStore } from '../store'
import AccountLoginModal from './AccountLoginModal'

type HomeLandingProps = {
  onOpenGallery: () => void
  onOpenCanvas: () => void
  onOpenSettings: () => void
}

const BACKGROUND_ROTATION_MS = 90_000
const FALLBACK_BACKGROUND_URL = 'https://www.loliapi.com/acg/pc/'

export default function HomeLanding({ onOpenGallery, onOpenCanvas, onOpenSettings }: HomeLandingProps) {
  const [backgroundUrls, setBackgroundUrls] = useState<[string, string]>([FALLBACK_BACKGROUND_URL, FALLBACK_BACKGROUND_URL])
  const [activeBackgroundIndex, setActiveBackgroundIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const activeBackgroundIndexRef = useRef(0)
  const backgroundRequestRef = useRef(0)
  const accountSession = useStore((state) => state.settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID] ?? null)

  const loadBackground = (url: string) => {
    const requestId = backgroundRequestRef.current + 1
    backgroundRequestRef.current = requestId
    const preload = new Image()
    preload.onload = () => {
      if (requestId !== backgroundRequestRef.current) return
      const nextIndex = activeBackgroundIndexRef.current === 0 ? 1 : 0
      setBackgroundUrls((current) => {
        const next = [...current] as [string, string]
        next[nextIndex] = preload.src
        return next
      })
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
    preload.src = url
  }

  useEffect(() => {
    loadBackground(`${PIXIV_RANDOM_BACKGROUND_API_URL}&home=${Date.now()}`)
  }, [])

  useEffect(() => {
    if (isPaused) return
    const timer = window.setInterval(() => {
      loadBackground(`${PIXIV_RANDOM_BACKGROUND_API_URL}&home=${Date.now()}`)
    }, BACKGROUND_ROTATION_MS)
    return () => window.clearInterval(timer)
  }, [isPaused])

  const refreshBackground = () => {
    loadBackground(`${PIXIV_RANDOM_BACKGROUND_API_URL}&home=${Date.now()}`)
  }

  return (
    <div className="home-landing min-h-screen overflow-hidden bg-[#11131c] text-white">
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
          <button type="button" className="home-landing-icon-button" onClick={onOpenSettings} title="设置"><Settings className="size-4" /><span className="hidden sm:inline">设置</span></button>
        </div>
      </header>
      <main className="relative z-10 flex min-h-[calc(100vh-112px)] items-center px-4 pb-16 sm:px-8 sm:pb-20">
        <div className="w-full max-w-2xl px-2 py-8 sm:px-4 sm:py-10">
          <p className="mb-5 text-xs font-semibold tracking-[0.36em] text-white/70">CREATIVE IMAGE STUDIO</p>
          <h1 className="max-w-2xl text-5xl font-semibold tracking-[0.02em] text-white drop-shadow-2xl sm:text-7xl">文运生图</h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-white/70 sm:text-base">把灵感变成画面，从一个想法开始。</p>
          <nav className="mt-10 flex max-w-xs flex-col gap-3" aria-label="工作区">
            <button type="button" className="home-landing-entry home-landing-entry-primary" onClick={onOpenGallery}><span className="grid size-10 place-items-center rounded-xl bg-gray-900/10"><WandSparkles className="size-5 text-gray-700" /></span><span className="flex-1 text-left"><strong>文运工坊</strong><small>生成与管理图片</small></span><span className="text-xl text-gray-500">›</span></button>
            <button type="button" className="home-landing-entry" onClick={onOpenCanvas}><span className="grid size-10 place-items-center rounded-xl bg-gray-900/10"><Sparkles className="size-5 text-gray-700" /></span><span className="flex-1 text-left"><strong>画布工坊</strong><small>组织画布创作</small></span><span className="text-xl text-gray-500">›</span></button>
          </nav>
          <div className="mt-5 flex items-center gap-2">
            <button type="button" className="home-landing-pause !px-2.5" onClick={() => setIsPaused((value) => !value)} aria-label={isPaused ? '继续轮播' : '暂停轮播'} title={isPaused ? '继续轮播' : '暂停轮播'}>{isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}</button>
            <button type="button" className="home-landing-pause !px-2.5" onClick={refreshBackground} aria-label="刷新背景" title="刷新背景"><RefreshCw className="size-3.5" /></button>
          </div>
        </div>
      </main>
      <AccountLoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  )
}
