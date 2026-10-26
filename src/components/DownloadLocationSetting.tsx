import { useEffect, useState } from 'react'
import { Checkbox } from './Checkbox'
import { chooseDownloadLocation, disableDownloadLocation, getDownloadLocation, supportsDownloadLocation, type DownloadLocationInfo } from '../lib/downloadLocation'

export function DownloadLocationSetting() {
  const [info, setInfo] = useState<DownloadLocationInfo>({ enabled: false, directory: '' })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const supported = supportsDownloadLocation()
  useEffect(() => {
    let active = true
    getDownloadLocation().then(value => { if (active) setInfo(value) })
      .catch(() => { if (active) setError('读取下载位置失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function change(enabled: boolean) {
    setBusy(true)
    setError('')
    try {
      const next = await (enabled ? chooseDownloadLocation() : disableDownloadLocation())
      if (next) setInfo(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '设置下载位置失败')
    } finally { setBusy(false) }
  }

  return <div className="rounded-xl border border-gray-200/60 p-4 dark:border-white/[0.08]">
    <div className="flex items-center justify-between gap-3">
      <Checkbox label="默认下载位置" checked={info.enabled} disabled={!supported || busy || loading} onChange={value => { void change(value) }} />
      {info.enabled && <button type="button" disabled={busy || loading} onClick={() => { void change(true) }} className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-500/15 dark:text-blue-300">更改位置</button>}
    </div>
    {info.enabled && <p className="mt-2 break-all text-xs text-gray-500 dark:text-gray-400">{info.directory}</p>}
    {!supported && <p className="mt-2 text-xs text-gray-500">当前环境不支持选择文件夹，下载将使用浏览器默认位置。</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </div>
}
