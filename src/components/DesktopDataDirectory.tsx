import { useEffect, useState } from 'react'
import { FolderOpen, FolderPen, LoaderCircle } from 'lucide-react'
import { getDesktopBridge } from '../lib/desktop'

export function DesktopDataDirectory() {
  const [directory, setDirectory] = useState('')
  const [error, setError] = useState('')
  const [changing, setChanging] = useState(false)
  useEffect(() => {
    void getDesktopBridge()?.info().then((info) => setDirectory(info.dataDirectory)).catch(() => setError('无法读取本地数据目录'))
  }, [])
  return <div className="border-b border-gray-200 pb-4 dark:border-white/10">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h4 className="text-sm font-semibold">本地数据</h4>
      <div className="flex flex-wrap gap-2">
        {getDesktopBridge()?.checkForUpdates && <button type="button" onClick={() => {
          void getDesktopBridge()?.checkForUpdates?.().catch(() => setError('暂时无法检查更新'))
        }} className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-200">检查更新</button>}
        <button type="button" disabled={changing} onClick={() => {
          setError('')
          void getDesktopBridge()?.openDataDirectory().catch(() => setError('数据目录无法打开'))
        }} className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-white/10 dark:text-gray-200">
          <FolderOpen size={16} />打开文件夹
        </button>
        <button type="button" disabled={changing} aria-busy={changing} onClick={async () => {
          setError('')
          setChanging(true)
          try {
            const result = await getDesktopBridge()?.changeDataDirectory()
            if (result) setDirectory(result.dataDirectory)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '更换存储位置失败，原数据已保留')
          } finally { setChanging(false) }
        }} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-500/15 dark:text-blue-300">
          {changing ? <LoaderCircle size={16} className="animate-spin" /> : <FolderPen size={16} />}
          {changing ? '迁移中…' : '更换位置'}
        </button>
      </div>
    </div>
    <p className="mt-2 break-all text-xs text-gray-500 dark:text-gray-400">{directory}</p>
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </div>
}
