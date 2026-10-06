import localforage from 'localforage'

type LocalFilePermissionMode = 'read' | 'readwrite'
type LocalFilePermissionState = 'granted' | 'denied' | 'prompt'

type LocalFileHandle = {
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>
    close: () => Promise<void>
  }>
  queryPermission?: (descriptor: { mode: LocalFilePermissionMode }) => Promise<LocalFilePermissionState>
  requestPermission?: (descriptor: { mode: LocalFilePermissionMode }) => Promise<LocalFilePermissionState>
}

type FilePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: Array<{
      description: string
      accept: Record<string, string[]>
    }>
    excludeAcceptAllOption?: boolean
  }) => Promise<LocalFileHandle>
}

const handleStore = localforage.createInstance({
  name: 'wenyun-workshop',
  storeName: 'local_sync_handles',
})

const LOCAL_SYNC_HANDLE_KEY = 'backup-file-handle'

export function isLocalFileSyncSupported() {
  if (typeof window === 'undefined') return false
  return typeof (window as FilePickerWindow).showSaveFilePicker === 'function' && window.isSecureContext
}

export function ensureZipFileName(fileName: string) {
  const trimmed = fileName.trim() || 'gpt-image-playground-backup.zip'
  return trimmed.endsWith('.zip') ? trimmed : `${trimmed}.zip`
}

async function getStoredHandle() {
  try {
    return await handleStore.getItem<LocalFileHandle>(LOCAL_SYNC_HANDLE_KEY)
  } catch {
    return null
  }
}

export async function hasLocalSyncFileHandle() {
  return Boolean(await getStoredHandle())
}

async function storeHandle(handle: LocalFileHandle) {
  await handleStore.setItem(LOCAL_SYNC_HANDLE_KEY, handle)
}

async function ensurePermission(handle: LocalFileHandle, mode: LocalFilePermissionMode, allowPrompt: boolean) {
  const current = await handle.queryPermission?.({ mode }).catch(() => undefined)
  if (current === 'granted' || !handle.requestPermission) return true
  if (!allowPrompt) return false
  const next = await handle.requestPermission({ mode }).catch(() => 'denied' as LocalFilePermissionState)
  return next === 'granted'
}

export async function getLocalSyncFileInfo() {
  const handle = await getStoredHandle()
  return handle ? { name: handle.name } : null
}

export async function chooseLocalSyncFile(fileName: string) {
  if (!isLocalFileSyncSupported()) {
    throw new Error('当前浏览器不支持本地硬盘同步，请使用 Chrome 或 Edge。')
  }

  // 浏览器必须由用户主动点击后才允许弹出硬盘文件选择窗口。
  const handle = await (window as FilePickerWindow).showSaveFilePicker?.({
    suggestedName: ensureZipFileName(fileName),
    types: [
      {
        description: '西米露备份文件',
        accept: { 'application/zip': ['.zip'] },
      },
    ],
    excludeAcceptAllOption: false,
  })

  if (!handle) throw new Error('没有选择本地备份文件')
  const granted = await ensurePermission(handle, 'readwrite', true)
  if (!granted) throw new Error('没有获得本地备份文件写入权限')

  await storeHandle(handle)
  return { name: handle.name }
}

export async function clearLocalSyncFile() {
  await handleStore.removeItem(LOCAL_SYNC_HANDLE_KEY)
}

export async function writeLocalSyncFile(blob: Blob, fileName: string, options: { allowPrompt?: boolean } = {}) {
  let handle = await getStoredHandle()
  if (!handle) {
    if (!options.allowPrompt) throw new Error('请先在同步设置里选择本地备份文件')
    handle = (await chooseLocalSyncFile(fileName)) && await getStoredHandle()
  }
  if (!handle) throw new Error('请先在同步设置里选择本地备份文件')

  const granted = await ensurePermission(handle, 'readwrite', options.allowPrompt === true)
  if (!granted) throw new Error('本地备份文件权限已失效，请重新选择文件授权')

  // 写入的是完整备份 zip，会覆盖同一个本地备份文件，方便定时同步保持一份最新数据。
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
  return { name: handle.name }
}

export async function readLocalSyncFile(options: { allowPrompt?: boolean } = {}) {
  const handle = await getStoredHandle()
  if (!handle) throw new Error('请先在同步设置里选择本地备份文件')

  const granted = await ensurePermission(handle, 'read', options.allowPrompt === true)
  if (!granted) throw new Error('本地备份文件读取权限已失效，请重新选择文件授权')

  return handle.getFile()
}
