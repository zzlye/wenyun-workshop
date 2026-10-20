import { useCallback, useEffect, useRef, useState } from 'react'
import { LOCKED_WENYUN_BASE_URL } from '../lib/apiProfiles'
import { fetchNewApiNotice, type NewApiNoticeResult } from '../lib/newApi'
import { useStore } from '../store'

const CHECK_INTERVAL = 30_000

function hashContent(content: string) {
  let hash = 0
  for (let index = 0; index < content.length; index += 1) {
    hash = ((hash << 5) - hash + content.charCodeAt(index)) | 0
  }
  return String(hash)
}

function noticeKey(notice: NewApiNoticeResult) {
  const latest = notice.items[0]
  // 只识别最新公告的稳定字段；抓取时间、旧公告清理均不触发新提醒。
  return 'v2:' + hashContent(JSON.stringify([
    latest?.id ?? '', latest?.content ?? notice.content,
    latest?.publishedAt ?? notice.publishedAt ?? '', latest?.type ?? '',
  ]))
}

export function useAnnouncement(enabled: boolean) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<NewApiNoticeResult>({ content: '', items: [], updatedAt: 0 })
  const [loading, setLoading] = useState(false)
  const seen = useRef(new Set<string>())
  const epoch = useRef(0)
  const pending = useRef<{ manual: boolean } | null>(null)

  const refresh = useCallback(async (manual = false) => {
    if (!enabled) return
    if (!manual && (document.visibilityState === 'hidden' || navigator.onLine === false)) return
    if (manual) setOpen(true)
    // 手动查看与自动检查共用同一请求，避免旧响应覆盖新公告。
    if (pending.current) {
      if (manual) pending.current.manual = true
      return
    }
    const request = { manual }
    pending.current = request
    const currentEpoch = epoch.current
    if (manual) setLoading(true)
    try {
      const result = await fetchNewApiNotice(LOCKED_WENYUN_BASE_URL)
      if (currentEpoch !== epoch.current) return
      setNotice(result)
      if (!result.content.trim()) return
      const key = noticeKey(result)
      const settings = useStore.getState().settings
      const dismissedToday = settings.announcementDismissedDate === new Date().toISOString().slice(0, 10)
        && (settings.announcementDismissedHash === key
          // 兼容旧版本保存的“今日不再提醒”。
          || settings.announcementDismissedHash === hashContent(result.content))
      // 永久免提醒已取消，旧客户端保存的该选项不再阻止公告弹出。
      if (request.manual) {
        seen.current.add(key)
      } else if (!dismissedToday && !seen.current.has(key)) {
        seen.current.add(key)
        setOpen(true)
      }
    } catch (error) {
      // 网络失败保留现有公告，下次检查自动重试，不影响正在生成的任务。
      console.warn('公告检查失败:', error)
    } finally {
      if (pending.current === request) pending.current = null
      if (currentEpoch === epoch.current) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    setLoading(false)
    const check = () => { void refresh() }
    check()
    const timer = window.setInterval(check, CHECK_INTERVAL)
    // 浏览器后台会节流计时器，返回页面或恢复网络时立即补查。
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      epoch.current += 1
      pending.current = null
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [enabled, refresh])

  const dismissToday = () => {
    useStore.getState().setSettings({
      announcementDismissedDate: new Date().toISOString().slice(0, 10),
      announcementDismissedHash: noticeKey(notice),
    })
    setOpen(false)
  }

  return { open, setOpen, notice, loading, openManually: () => { void refresh(true) }, dismissToday }
}
