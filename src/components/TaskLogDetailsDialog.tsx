import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, Download, RefreshCw, X } from 'lucide-react'
import type { LogPanelProps } from './TaskLogsPanel'
import { fetchAccountTaskDetails, taskLogStatus, type AccountTaskLog, type AccountTaskMedia } from '../lib/newApiTaskLogs'
import { requestNewApiAccountMedia, isNewApiAuthenticationError, fetchNewApiSiteStatus } from '../lib/newApiAccount'
import { formatLotteryQuota } from '../lib/newApiLottery'
import { usageLogTime } from '../lib/newApiLogs'
import { copyTextToClipboard } from '../lib/clipboard'
import { downloadFile } from '../lib/downloadLocation'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useLogRefreshGuard } from '../hooks/useLogRefreshGuard'

const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs hover:bg-gray-100 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10'
const queryOptions = { retry: false, retryOnMount: false, staleTime: 20000, gcTime: 60000, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const
const labels: Record<string, string> = { model: '模型', size: '尺寸', quality: '品质', n: '数量', output_format: '输出格式', response_format: '响应格式', background: '背景', moderation: '审核', seconds: '时长', duration: '时长', aspect_ratio: '宽高比', resolution: '分辨率', seed: '种子', negative_prompt: '负面提示词', stream: '流式输出', output_compression: '压缩质量', fps: '帧率', watermark: '水印', generate_audio: '生成音频' }

export default function TaskLogDetailsDialog({ task, profile, session, onSessionUpdated, onRequireLogin, onClose }: LogPanelProps & { task: AccountTaskLog; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null)
  const [copyMessage, setCopyMessage] = useState('')
  const isAsync = task.isAsync && task.taskId.startsWith('async_')
  useCloseOnEscape(true, onClose)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  const identity = [profile.baseUrl, session.userId ?? session.username, session.authSessionId ?? session.accessToken]
  const details = useQuery({ queryKey: ['wenyun-task-details', ...identity, task.taskId], queryFn: ({ signal }) => fetchAccountTaskDetails(profile, session, task.taskId, signal, onSessionUpdated), enabled: isAsync, ...queryOptions })
  const site = useQuery({ queryKey: ['wenyun-usage-logs-currency', profile.baseUrl], queryFn: ({ signal }) => fetchNewApiSiteStatus(profile, signal), ...queryOptions, staleTime: 60000 })
  const guard = useLogRefreshGuard(Math.max(details.dataUpdatedAt, details.errorUpdatedAt), details.isFetching)
  const expiredSession = isNewApiAuthenticationError(details.error)
  const data = details.data
  const field = (label: string, value: string | number) => <div key={label} className="min-w-0"><dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt><dd className="mt-1 select-text whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{value || '—'}</dd></div>
  const time = (value?: number) => value ? usageLogTime(value) : '—'
  const fullParameters = data ? data.fullParameters ?? {
    task_id: data.taskId, model_name: data.model || task.model, request_method: data.requestMethod, request_path: data.requestPath, request_format: data.requestFormat,
    request_details: { prompt: data.prompt, prompt_source: data.promptSource, parameters: data.parameters, references: (data.references ?? []).map(media => ({ role: media.role, content_type: media.contentType, kind: media.kind })) },
    created_at: data.submitTime, started_at: data.startTime, finished_at: data.finishTime, status: data.status, response_status_code: data.responseStatusCode,
  } : undefined
  const refresh = () => { if (expiredSession) onRequireLogin(); else if (guard.claim()) void details.refetch({ cancelRefetch: false }) }
  const copy = async (value: string) => { try { await copyTextToClipboard(value); setCopyMessage('已复制') } catch { setCopyMessage('复制失败，请重试') } }
  return <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-2 backdrop-blur-sm sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={root} role="dialog" aria-modal="true" aria-label="任务详情" data-task-details-dialog className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-gray-800 shadow-2xl dark:border-white/15 dark:bg-gray-900 dark:text-gray-100" onKeyDown={event => {
      if (event.key !== 'Tab') return
      event.stopPropagation()
      const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]') ?? []).filter(node => node.getClientRects().length > 0)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/10"><h3 className="text-base font-semibold">任务详情</h3><div className="flex items-center gap-2">{isAsync && <button type="button" className={buttonClass} aria-label="刷新任务详情" disabled={guard.disabled || expiredSession} onClick={refresh}><RefreshCw size={13} className={details.isFetching ? 'animate-spin' : ''} />刷新</button>}<button ref={close} type="button" className={buttonClass} aria-label="关闭任务详情" onClick={onClose}><X size={15} /></button></div></header>
      <div className="min-h-0 space-y-5 overflow-auto p-4 sm:p-5">
        <dl className="grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><dt className="text-xs text-gray-500 dark:text-gray-400">任务 ID</dt><dd className="mt-1 flex items-center gap-2"><code className="min-w-0 select-text break-all text-xs">{task.taskId}</code><button type="button" aria-label="复制任务 ID" className={buttonClass} onClick={() => void copy(task.taskId)}><Copy size={12} /></button></dd></div>{field('接口地址', [data?.requestMethod || task.requestMethod, data?.requestPath || task.requestPath].filter(Boolean).join(' '))}{field('模型', data?.model || task.model)}{field('状态', taskLogStatus(data?.status || task.status))}{field('响应状态码', data?.responseStatusCode || '—')}{!isAsync && <>{field('平台', task.platform)}{field('动作', task.action)}{field('实际模型', task.upstreamModel || '—')}{field('进度', task.progress)}</>}{field('分组', task.group)}{field('额度', formatLotteryQuota(task.quota, site.data ?? null))}</dl>
        <dl className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5 sm:grid-cols-2 lg:grid-cols-3">{field('提交时间', time(data?.submitTime || task.submitTime))}{field('生成开始时间', time(data?.startTime || task.startTime))}{field('接口返回时间', time(data?.responseTime))}{field('任务完成时间', time(data?.finishTime || task.finishTime))}{field('文件到期时间', time(data?.expiresAt))}{field('请求耗时', data?.responseTime && data.startTime ? `${Math.max(0, data.responseTime - data.startTime)}s` : '—')}</dl>
        {details.isFetching && <p role="status" className="text-sm text-gray-500">正在读取任务详情…</p>}
        {details.isError && <div role="alert" className="space-y-2"><p className="text-sm text-red-500">{details.error.message}</p><button type="button" className={buttonClass} disabled={!expiredSession && guard.disabled} onClick={refresh}>{expiredSession ? '重新登录' : '重试详情'}</button></div>}
        {(data?.error || task.failReason) && <section aria-label="失败原因" className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30"><h4 className="mb-1 text-sm font-semibold text-red-700 dark:text-red-300">失败原因</h4><p className="select-text whitespace-pre-wrap break-words text-sm text-red-700 [overflow-wrap:anywhere] dark:text-red-300">{data?.error || task.failReason}</p></section>}
        {data && <>
          <section aria-label="任务参数"><div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold">任务参数</h4><button type="button" className={buttonClass} onClick={() => void copy(JSON.stringify(fullParameters, null, 2))}>复制参数</button></div><pre className="max-h-64 select-text overflow-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs [overflow-wrap:anywhere] dark:border-white/10 dark:bg-white/5">{JSON.stringify(fullParameters, null, 2)}</pre></section>
          <section aria-label="生成提示词"><h4 className="mb-2 text-sm font-semibold">{data.promptSource === 'upstream_revised' ? '上游修订提示词' : '生成提示词'}</h4><pre className="max-h-64 select-text overflow-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 p-3 font-sans text-sm [overflow-wrap:anywhere] dark:border-white/10">{data.prompt || (data.inputAvailable ? '未记录提示词' : '该历史任务未保存原始输入')}</pre>{data.inputError && <p className="mt-1 text-xs text-gray-500">{data.inputError}</p>}</section>
          {Object.keys(data.parameters).length > 0 && <section aria-label="生成参数"><h4 className="mb-2 text-sm font-semibold">生成参数</h4><dl className="grid gap-3 rounded-lg border border-gray-200 p-4 dark:border-white/10 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(data.parameters).map(([key, value]) => field(labels[key] || key, value))}</dl></section>}
          <MediaGallery title="参考素材" items={data.references ?? []} expired={data.mediaExpired || task.mediaExpired} expiresAt={data.expiresAt} profile={profile} session={session} onSessionUpdated={onSessionUpdated} onRequireLogin={onRequireLogin} />
          <MediaGallery title="生成结果" items={data.media ?? []} expired={data.mediaExpired || task.mediaExpired} expiresAt={data.expiresAt} profile={profile} session={session} onSessionUpdated={onSessionUpdated} onRequireLogin={onRequireLogin} />
        </>}
        {!data && task.mediaExpired && <p className="text-sm text-amber-600 dark:text-amber-300">结果文件已过期</p>}{copyMessage && <p role="status" className="text-xs text-gray-500 dark:text-gray-400">{copyMessage}</p>}
      </div>
    </div>
  </div>
}

function MediaGallery({ title, items, expired, expiresAt, ...props }: LogPanelProps & { title: string; items: AccountTaskMedia[]; expired?: boolean; expiresAt?: number }) {
  const [timeExpired, setTimeExpired] = useState(Boolean(expiresAt && expiresAt * 1000 <= Date.now()))
  useEffect(() => {
    const remaining = expiresAt ? expiresAt * 1000 - Date.now() : undefined
    setTimeExpired(remaining !== undefined && remaining <= 0)
    if (remaining === undefined || remaining <= 0) return
    // 长保留期分段计时，避免浏览器计时上限让文件提前显示过期。
    let timer: ReturnType<typeof setTimeout>
    const checkExpiry = () => {
      const left = expiresAt! * 1000 - Date.now()
      if (left <= 0) setTimeExpired(true)
      else timer = setTimeout(checkExpiry, Math.min(left, 2147483647))
    }
    checkExpiry()
    return () => clearTimeout(timer)
  }, [expiresAt])
  return <section aria-label={title}><h4 className="mb-2 text-sm font-semibold">{title}</h4>{expired || timeExpired ? <p className="text-sm text-gray-500">{title}文件已过期</p> : !items.length ? <p className="text-sm text-gray-500">暂无{title}</p> : <div className="grid gap-3 sm:grid-cols-2">{items.map((media, index) => <TaskMediaPreview key={`${media.url}-${index}`} {...props} media={media} index={index} />)}</div>}</section>
}

function TaskMediaPreview({ media, index, profile, session, onSessionUpdated, onRequireLogin }: LogPanelProps & { media: AccountTaskMedia; index: number }) {
  const [enabled, setEnabled] = useState(false), [objectUrl, setObjectUrl] = useState(''), [error, setError] = useState('')
  const query = useQuery({ queryKey: ['wenyun-task-media', profile.baseUrl, session.userId ?? session.username, session.authSessionId ?? session.accessToken, media.url], queryFn: ({ signal }) => requestNewApiAccountMedia(profile, session, media.url, AbortSignal.any([signal, AbortSignal.timeout(120000)]), onSessionUpdated), enabled: enabled && Boolean(media.url), ...queryOptions, staleTime: Infinity, gcTime: 0 })
  const guard = useLogRefreshGuard(Math.max(query.dataUpdatedAt, query.errorUpdatedAt), query.isFetching)
  useEffect(() => {
    if (!query.data) return
    const url = URL.createObjectURL(query.data); setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [query.data])
  const kind = { image: '图片', video: '视频', audio: '音频' }[media.kind]
  const save = async () => {
    if (!query.data) return
    const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/wave': 'wav' } as Record<string, string>)[query.data.type] || 'bin'
    try { await downloadFile(query.data, `任务${kind}-${index + 1}.${ext}`); setError('') } catch { setError('下载失败，请重试') }
  }
  // 文件需主动点击才下载；关掉详情即取消读取并回收临时地址，不批量加载大图。
  return <figure className="min-w-0 rounded-lg border border-gray-200 p-3 dark:border-white/10"><figcaption className="mb-2 truncate text-xs text-gray-500 dark:text-gray-400">{media.name || `${kind} ${index + 1}`}</figcaption>
    {!media.url ? <p className="text-sm text-gray-500">{media.error || '文件未保存或已清理'}</p> : <>{!enabled && <button type="button" className={buttonClass} onClick={() => setEnabled(true)}>预览{kind}</button>}{query.isFetching && <p role="status" className="text-xs text-gray-500">正在读取文件…</p>}{query.isError && <div role="alert"><p className="mb-2 text-xs text-red-500">{query.error.message}</p><button type="button" className={buttonClass} disabled={!isNewApiAuthenticationError(query.error) && guard.disabled} onClick={() => { if (isNewApiAuthenticationError(query.error)) onRequireLogin(); else if (guard.claim()) void query.refetch({ cancelRefetch: false }) }}>{isNewApiAuthenticationError(query.error) ? '重新登录' : '重试预览'}</button></div>}{objectUrl && <>{media.kind === 'image' ? <img src={objectUrl} alt={media.name || `任务图片 ${index + 1}`} className="max-h-80 w-full rounded object-contain" /> : media.kind === 'video' ? <video src={objectUrl} controls preload="metadata" className="max-h-80 w-full rounded" /> : <audio src={objectUrl} controls preload="metadata" className="w-full" />}<button type="button" className={`${buttonClass} mt-2`} onClick={() => void save()}><Download size={12} />下载</button></>}</>}
    {error && <p role="alert" className="mt-1 text-xs text-red-500">{error}</p>}
  </figure>
}
