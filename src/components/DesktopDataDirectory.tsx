import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { getDesktopBridge } from '../lib/desktop'

export function DesktopDataDirectory() {
  const [directory, setDirectory] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    void getDesktopBridge()?.info().then((info) => setDirectory(info.dataDirectory)).catch(() => setError('无法读取本地数据目录'))
  }, [])
  return <div className="border-b border-gray-200 pb-4 dark:border-white/10">
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-sm font-semibold">本地数据</h4>
      <button type="button" onClick={() => {
        setError('')
        void getDesktopBridge()?.openDataDirectory().catch(() => setError('数据目录无法打开'))
      }} className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-200">
        <FolderOpen size={16} />打开文件夹
      </button>
    </div>
    <p className="mt-2 break-all text-xs text-gray-500 dark:text-gray-400">{directory}</p>
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </div>
}
