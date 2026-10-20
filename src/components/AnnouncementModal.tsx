import { CloseIcon } from './icons'
import MarkdownRenderer from './MarkdownRenderer'
import type { NewApiNoticeItem } from '../lib/newApi'

interface AnnouncementModalProps {
  content: string
  items: NewApiNoticeItem[]
  loading?: boolean
  publishedAt?: string
  onClose: () => void
  onDismissToday: () => void
}

function formatAnnouncementDate(value: string | undefined) {
  if (!value?.trim()) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { hour12: false })
}

function formatRelativeTime(value: string | undefined) {
  if (!value?.trim()) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (diffSeconds < 60) return '刚刚'
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays} 天前`
  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `${diffMonths} 个月前`
  return `${Math.floor(diffMonths / 12)} 年前`
}

export default function AnnouncementModal({
  content,
  items,
  loading = false,
  publishedAt,
  onClose,
  onDismissToday,
}: AnnouncementModalProps) {
  const displayDate = formatAnnouncementDate(publishedAt)
  const displayItems = items.slice(0, 20)

  return (
    <div data-no-drag-select className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm animate-overlay-in" onClick={onClose} />
      <div className="relative z-10 flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-100 p-5 dark:border-white/[0.08]">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">系统公告</h3>
            <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 dark:border-white/[0.08] dark:text-gray-400">
              显示最新20条
            </span>
            {displayDate && (
              <span className="truncate text-xs text-gray-400 dark:text-gray-500">
                {displayDate}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭公告"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div data-selectable-text className="min-h-[180px] flex-1 overflow-y-auto p-5 custom-scrollbar select-text">
          {loading ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">公告加载中...</div>
          ) : displayItems.length > 0 ? (
            <div className="space-y-0">
              {displayItems.map((item, index) => {
                const dateText = formatAnnouncementDate(item.publishedAt)
                const relativeText = formatRelativeTime(item.publishedAt)
                return (
                  <div key={`${item.id ?? index}-${item.publishedAt ?? ''}`} className="relative flex gap-4 pb-6 last:pb-0">
                    <div className="flex w-3 shrink-0 flex-col items-center pt-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-gray-300 ring-4 ring-white dark:bg-gray-600 dark:ring-gray-900" />
                      {index < displayItems.length - 1 && (
                        <span className="mt-2 w-px flex-1 bg-gray-200 dark:bg-white/[0.08]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <MarkdownRenderer content={item.content} className="announcement-markdown prose-sm max-w-none text-gray-700 dark:text-gray-200" />
                      {(relativeText || dateText) && (
                        <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                          {[relativeText, dateText].filter(Boolean).join(' ')}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : content.trim() ? (
            <MarkdownRenderer content={content} className="announcement-markdown prose-sm max-w-none text-gray-700 dark:text-gray-200" />
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">暂无公告</div>
          )}
        </div>

        <div className="flex shrink-0 justify-end border-t border-gray-100 p-4 dark:border-white/[0.08]">
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onDismissToday}
              className="rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
            >
              今日不再提醒
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
