import localforage from 'localforage'
import { saveAs } from 'file-saver'
import { getDesktopBridge } from './desktop'

export interface DownloadLocationInfo { enabled: boolean; directory: string }
interface DirectoryHandle {
  name: string
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  getFileHandle(name: string, options?: { create: boolean }): Promise<{
    createWritable(): Promise<{ write(blob: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>
  }>
}
type PickerWindow = Window & {
  showDirectoryPicker?: (options: { id: string; mode: 'readwrite' }) => Promise<DirectoryHandle>
}
type BrowserPreference = { enabled: boolean; handle: DirectoryHandle }

// 目录授权只属于当前设备，不放进账号配置、云同步或导出的备份。
const preferences = localforage.createInstance({ name: 'wenyun-downloads', storeName: 'preferences', driver: localforage.INDEXEDDB })
const preferenceKey = 'directory'

export function supportsDownloadLocation() {
  const desktop = getDesktopBridge()
  if (desktop) return Boolean(desktop.downloads)
  return typeof window !== 'undefined' && window.isSecureContext && typeof (window as PickerWindow).showDirectoryPicker === 'function'
}

export async function getDownloadLocation(): Promise<DownloadLocationInfo> {
  const desktop = getDesktopBridge()
  if (desktop) return desktop.downloads?.info() ?? { enabled: false, directory: '' }
  if (!supportsDownloadLocation()) return { enabled: false, directory: '' }
  const preference = await preferences.getItem<BrowserPreference>(preferenceKey)
  return { enabled: preference?.enabled === true, directory: preference?.handle.name ?? '' }
}

export async function chooseDownloadLocation(): Promise<DownloadLocationInfo | null> {
  const desktop = getDesktopBridge()
  if (desktop?.downloads) return desktop.downloads.choose()
  if (!supportsDownloadLocation()) throw new Error('当前浏览器不支持选择下载文件夹，请使用新版 Chrome 或 Edge')
  try {
    // 必须在点击事件中直接调用选择器，不能先等待网络或读取存储。
    const handle = await (window as PickerWindow).showDirectoryPicker!({ id: 'wenyun-downloads', mode: 'readwrite' })
    await preferences.setItem(preferenceKey, { enabled: true, handle })
    return { enabled: true, directory: handle.name }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return null
    throw error
  }
}

export async function disableDownloadLocation(): Promise<DownloadLocationInfo> {
  const desktop = getDesktopBridge()
  if (desktop?.downloads) return desktop.downloads.disable()
  const preference = await preferences.getItem<BrowserPreference>(preferenceKey)
  if (preference) await preferences.setItem(preferenceKey, { ...preference, enabled: false })
  return { enabled: false, directory: preference?.handle.name ?? '' }
}

export function safeDownloadName(name: string) {
  const clean = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 180).replace(/[. ]+$/g, '') || 'download'
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean
}

async function writeToDirectory(handle: DirectoryHandle, blob: Blob, name: string) {
  if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new Error('下载文件夹授权已失效，请在设置中重新选择下载位置')
  }
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let index = 0; index < 10000; index++) {
    const candidate = index ? `${base} (${index})${extension}` : name
    try {
      await handle.getFileHandle(candidate)
      continue
    } catch (error) {
      // 只在文件不存在时创建，权限错误、磁盘错误不能当成文件不存在。
      if (!(error instanceof Error) || error.name !== 'NotFoundError') throw error
    }
    const file = await handle.getFileHandle(candidate, { create: true })
    const writable = await file.createWritable()
    try {
      await writable.write(blob)
      await writable.close()
    } catch (error) {
      await writable.abort().catch(() => undefined)
      throw error
    }
    return
  }
  throw new Error('同名文件过多，请更换下载位置')
}

let saveQueue: Promise<unknown> = Promise.resolve()

export async function downloadFile(blob: Blob, filename: string) {
  const name = safeDownloadName(filename)
  const desktop = getDesktopBridge()
  if (desktop) {
    if (desktop.downloads && (await desktop.downloads.info()).enabled) {
      await desktop.downloads.save(name, await blob.arrayBuffer())
      return
    }
    saveAs(blob, name)
    return
  }
  if (!supportsDownloadLocation()) { saveAs(blob, name); return }
  const preference = await preferences.getItem<BrowserPreference>(preferenceKey)
  if (!preference?.enabled) { saveAs(blob, name); return }
  // 同一站点多标签页也串行分配文件名，重复下载不会覆盖已有文件。
  const write = () => writeToDirectory(preference.handle, blob, name)
  if (navigator.locks) return navigator.locks.request('wenyun-download-write', write)
  const operation = saveQueue.then(write)
  saveQueue = operation.catch(() => undefined)
  await operation
}
