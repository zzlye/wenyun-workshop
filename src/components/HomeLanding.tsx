import { useEffect, useState } from 'react'
import { LogIn, Pause, Play, Settings, Sparkles, WandSparkles } from 'lucide-react'
import { PIXIV_RANDOM_BACKGROUND_API_URL } from '../lib/apiProfiles'
import AccountLoginModal from './AccountLoginModal'

type HomeLandingProps = {
  onOpenGallery: () => void
  onOpenCanvas: () => void
  onOpenSettings: () => void
}

const BACKGROUND_ROTATION_MS = 90_000
const FALLBACK_BACKGROUND_URL = 'https://www.loliapi.com/acg/pc/'

export default function HomeLanding({ onOpenGallery, onOpenCanvas, onOpenSettings }: HomeLandingProps) {
  const [backgroundUrl, setBackgroundUrl] = useState(FALLBACK_BACKGROUND_URL)
  const [isPaused, setIsPaused] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [backgroundReady, setBackgroundReady] = useState(true)

  const loadBackground = (url: string) => {
    const preload = new Image()
    preload.onload = () => {
      setBackgroundUrl(preload.src)
      setBackgroundReady(true)
    }
    preload.onerror = () => {
      if (url !== FALLBACK_BACKGROUND_URL) {
        loadBackground(`${FALLBACK_BACKGROUND_URL}?home=${Date.now()}`)
        return
      }
      setBackgroundReady(true)
    }
    preload.src = url
  }

  useEffect(() => {
    loadBackground(`${PIXIV_RANDOM_BACKGROUND_API_URL}&home=${Date.now()}`)
  }, [])

  useEffect(() => {
    if (isPaused) return
    const timer = window.setInterval(() => {
      setBackgroundReady(false)
      loadBackground(`${PIXIV_RANDOM_BACKGROUND_API_URL}&home=${Date.now()}`)
    }, BACKGROUND_ROTATION_MS)
    return () => window.clearInterval(timer)
  }, [isPaused])

  return (
    <div className="home-landing min-h-screen overflow-hidden bg-[#11131c] text-white">
      <div aria-hidden className={`home-landing-background ${backgroundReady ? 'home-landing-background-ready' : ''}`} style={{ backgroundImage: `url("${backgroundUrl}")` }} />
      <div aria-hidden className="home-landing-shade" />
      <header className="home-landing-header relative z-10 mx-4 mt-4 flex items-center justify-between rounded-2xl px-4 py-3 sm:mx-8 sm:mt-8 sm:px-5 sm:py-4">
        <div className="flex items-center gap-3 text-sm font-semibold tracking-[0.18em] text-white/80">
          <span className="grid size-9 place-items-center rounded-xl border border-white/20 bg-black/20 backdrop-blur-md"><Sparkles className="size-4 text-pink-200" /></span>
          文运生图
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="home-landing-icon-button" onClick={() => setShowLogin(true)} title="登录"><LogIn className="size-4" /><span className="hidden sm:inline">登录</span></button>
          <button type="button" className="home-landing-icon-button" onClick={onOpenSettings} title="设置"><Settings className="size-4" /><span className="hidden sm:inline">设置</span></button>
        </div>
      </header>
      <main className="relative z-10 flex min-h-[calc(100vh-112px)] items-center px-4 pb-16 sm:px-8 sm:pb-20">
        <div className="home-landing-panel w-full max-w-2xl rounded-3xl px-6 py-8 sm:px-10 sm:py-10">
          <p className="mb-5 text-xs font-semibold tracking-[0.36em] text-pink-100/75">CREATIVE IMAGE STUDIO</p>
          <h1 className="max-w-2xl text-5xl font-semibold tracking-[0.02em] text-white drop-shadow-2xl sm:text-7xl">文运生图</h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-white/70 sm:text-base">把灵感变成画面，从一个想法开始。</p>
          <nav className="mt-10 flex max-w-sm flex-col gap-3" aria-label="工作区">
            <button type="button" className="home-landing-entry home-landing-entry-primary" onClick={onOpenGallery}><span className="grid size-10 place-items-center rounded-xl bg-white/15"><WandSparkles className="size-5" /></span><span className="flex-1 text-left"><strong>文运工坊</strong><small>快速生成与管理图片</small></span><span className="text-xl text-white/50">›</span></button>
            <button type="button" className="home-landing-entry" onClick={onOpenCanvas}><span className="grid size-10 place-items-center rounded-xl bg-pink-300/15"><Sparkles className="size-5 text-pink-100" /></span><span className="flex-1 text-left"><strong>画布工坊</strong><small>在无限画布中组织创作</small></span><span className="text-xl text-white/50">›</span></button>
          </nav>
          <button type="button" className="home-landing-pause" onClick={() => setIsPaused((value) => !value)}>{isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}{isPaused ? '继续轮播' : '暂停轮播'}</button>
        </div>
      </main>
      <AccountLoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  )
}
