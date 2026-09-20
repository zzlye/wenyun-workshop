import { useEffect, useState } from 'react'
import type { ApiProfile, NewApiAccountSession } from '../types'
import { fetchNewApiAccountRole, requestNewApiVideoProtocol } from '../lib/newApiAccount'
import { VideoProtocolForm, type VideoProtocol, type VideoProtocolCatalog } from './VideoProtocolForm'

const labels: Record<string, string> = {
  'Enable video protocol': '启用渠道视频协议', 'Submit path': '提交路径', 'Poll path': '查询路径',
  'Poll ID field': '查询请求中的任务编号字段', 'Content path': '视频下载路径', 'Authentication field': '鉴权字段',
  'Authentication prefix': '鉴权前缀', 'Request encoding': '请求格式', 'Poll method': '查询方式', 'Authentication mode': '鉴权方式',
  'Task ID path': '任务编号位置', 'Task status path': '任务状态位置', 'Video URL path': '视频地址位置', 'Error message path': '错误信息位置', 'Progress path': '进度位置',
  'Video parameter mapping': '视频参数映射', 'Input field': '统一输入字段', 'Upstream field': '上游字段', 'Value format': '值格式', 'Object URL field': '对象内地址字段',
  'Remove mapping': '移除映射', 'Add mapping': '添加映射', 'Response mapping and extra parameters': '响应映射与附加参数',
  'Extra parameters': '附加参数', 'Task state mapping': '任务状态映射',
  'Extra request headers': '附加请求头', 'Enter a JSON object': '请输入有效的 JSON 对象',
  'Paths are relative to the channel URL. Use {id} for the task ID. Leave content path empty to download the result URL.': '路径相对于渠道地址，任务编号使用 {id}。下载路径留空时使用结果里的视频地址。',
  'Use dots for nested fields and | for alternative response paths. Extra parameters cannot replace mapped fields.': '嵌套字段使用点号，多个候选响应位置使用 | 分隔。附加参数不能覆盖已有映射。',
  'video.format.identity': '保持原值', 'video.format.string': '字符串', 'video.format.number': '数字', 'video.format.boolean': '布尔值',
  'video.format.single': '单个地址', 'video.format.single_object': '单个地址对象', 'video.format.objects': '地址对象数组', 'video.format.frames': '首尾帧对象',
  'video.preset.standard': '标准数组协议', 'video.preset.reference_object': '参考图对象协议', 'video.preset.reference_string': '参考图字符串协议',
}

export function VideoProtocolManager(props: { profile: ApiProfile; session?: NewApiAccountSession }) {
  const [verifiedAccount, setVerifiedAccount] = useState('')
  const account = `${props.profile.id}:${props.session?.userId}:${props.session?.accessToken}`
  useEffect(() => {
    let active = true
    setVerifiedAccount('')
    if (props.session) void fetchNewApiAccountRole(props.profile, props.session).then(role => {
      if (active && role === 100) setVerifiedAccount(account)
    }).catch(() => { /* 会话未验证时不展示管理入口。 */ })
    return () => { active = false }
  }, [account, props.profile, props.session])
  // 前端只控制入口展示，真实读写权限由 NewAPI 的根用户接口校验。
  if (!props.session || verifiedAccount !== account) return null
  return <RootVideoProtocolManager key={account} profile={props.profile} session={props.session} />
}

function RootVideoProtocolManager(props: { profile: ApiProfile; session: NewApiAccountSession }) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<VideoProtocolCatalog | null>(null)
  const [channelId, setChannelId] = useState(0)
  const [draft, setDraft] = useState<VideoProtocol | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    if (open) void requestNewApiVideoProtocol<VideoProtocolCatalog>(props.profile, props.session).then(value => {
      if (active) { setCatalog(value); setError('') }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '渠道加载失败') })
    return () => { active = false }
  }, [open, props.profile, props.session])
  useEffect(() => {
    let active = true
    setDraft(null); setMessage(''); setError('')
    if (channelId) void requestNewApiVideoProtocol<VideoProtocol>(props.profile, props.session, channelId).then(value => {
      if (active) setDraft(value)
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '协议加载失败') })
    return () => { active = false }
  }, [channelId, props.profile, props.session])
  async function save() {
    if (!draft || !channelId) return
    setBusy(true); setError(''); setMessage('')
    try {
      const value = await requestNewApiVideoProtocol<VideoProtocol>(props.profile, props.session, channelId, draft)
      setDraft(value); setMessage('渠道协议已保存')
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className='min-w-0 rounded-xl border border-gray-200 p-4 dark:border-white/10'>
    <summary className='cursor-pointer text-sm font-semibold'>视频渠道协议</summary>
    <div className='mt-4 space-y-4'>
      <p className='text-xs text-gray-500'>配置对所选渠道的所有视频模型生效，已提交的任务继续使用原有规则。</p>
      {error ? <p role='alert' className='text-sm text-red-500'>{error}</p> : null}
      {!catalog && !error ? <p role='status' className='text-sm'>正在加载渠道…</p> : null}
      {catalog ? <label className='block text-sm'>渠道<select aria-label='渠道' className='mt-1 w-full rounded-lg border bg-transparent p-2' value={channelId} disabled={busy} onChange={e => setChannelId(Number(e.target.value))}>
        <option value={0}>选择渠道</option>{catalog.channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}（{channel.id}）</option>)}
      </select></label> : null}
      {draft && catalog ? <>
        <label className='block text-sm'>协议预设<select className='ml-2 rounded-lg border bg-transparent p-2' value='' disabled={busy} onChange={e => { const p = catalog.presets[e.target.value]; if (p) { setDraft(structuredClone(p)); setMessage('') } }}>
          <option value=''>选择预设</option>{Object.keys(catalog.presets).map(key => <option key={key} value={key}>{labels[`video.preset.${key}`] || key}</option>)}
        </select></label>
        <VideoProtocolForm value={draft} onChange={value => { setDraft(value); setMessage('') }} disabled={busy} t={key => labels[key] || key} />
        <button type='button' disabled={busy} className='rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50' onClick={e => {
          const invalid = e.currentTarget.closest('details')?.querySelector<HTMLTextAreaElement>('textarea:invalid')
          if (invalid) { invalid.reportValidity(); return }
          void save()
        }}>{busy ? '保存中…' : '保存渠道协议'}</button>
      </> : null}
      {message ? <p role='status' className='text-sm'>{message}</p> : null}
    </div>
  </details>
}
