import type { StateStorage } from 'zustand/middleware'

export type DesktopScope = 'tasks' | 'images' | 'thumbnails' | 'agentConversations' | 'canvas-state' | 'canvas-images' | 'canvas-media' | 'settings'

export interface DesktopBridge {
  version: number
  info(): Promise<{ version: string; dataDirectory: string }>
  openDataDirectory(): Promise<void>
  changeDataDirectory(): Promise<{ dataDirectory: string } | null>
  openPayment(order: { kind: 'redirect'; url: string } | { kind: 'form'; url: string; fields: Record<string, string> }): Promise<void>
  storage: {
    get<T>(scope: DesktopScope, key: string): Promise<T | null>
    all<T>(scope: DesktopScope): Promise<T[]>
    keys(scope: DesktopScope): Promise<string[]>
    put(scope: DesktopScope, key: string, value: unknown): Promise<string>
    remove(scope: DesktopScope, key: string): Promise<void>
    clear(scope: DesktopScope): Promise<void>
    replace(scope: DesktopScope, values: unknown[]): Promise<void>
    flush(): Promise<void>
  }
  agent: {
    ensure(): Promise<{ url: string; token: string }>
    login(): Promise<void>
  }
  onBeforeClose(prepare: () => Promise<{ busy: boolean }>): () => void
}

declare global {
  interface Window { wenyunDesktop?: DesktopBridge }
}

export function getDesktopBridge() {
  return typeof window === 'undefined' ? undefined : window.wenyunDesktop
}

export function createDesktopStateStorage(scope: 'canvas-state' | 'settings'): StateStorage | undefined {
  const bridge = getDesktopBridge()
  if (!bridge) return undefined
  return {
    getItem: (key) => bridge.storage.get<string>(scope, key),
    setItem: async (key, value) => { await bridge.storage.put(scope, key, value) },
    removeItem: (key) => bridge.storage.remove(scope, key),
  }
}

export const desktopSettingsStorage = createDesktopStateStorage('settings')

export function desktopRequestUrl(value: string) {
  if (!getDesktopBridge()) return value
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return value
    return `/desktop-api/${url.protocol.slice(0, -1)}/${url.host}${url.pathname}${url.search}`
  } catch { return value }
}

export function createDesktopBlobStorage(scope: 'canvas-images' | 'canvas-media') {
  const bridge = getDesktopBridge()
  if (!bridge) return undefined
  return {
    async getItem<T>(key: string): Promise<T | null> {
      const item = await bridge.storage.get<{ bytes: Uint8Array; mimeType: string }>(scope, key)
      return item ? new Blob([new Uint8Array(item.bytes)], { type: item.mimeType }) as T : null
    },
    async setItem<T>(key: string, value: T): Promise<T> {
      if (!(value instanceof Blob)) throw new Error('本地素材必须是文件')
      // Blob 不能直接通过隔离桥传输，只传原始字节及类型，不重新编码媒体。
      await bridge.storage.put(scope, key, { bytes: await value.arrayBuffer(), mimeType: value.type || 'application/octet-stream' })
      return value
    },
    removeItem: (key: string) => bridge.storage.remove(scope, key),
    async iterate<T, U>(iterator: (value: T, key: string, index: number) => U | void): Promise<U | undefined> {
      const keys = await bridge.storage.keys(scope)
      for (let index = 0; index < keys.length; index++) {
        const value = await this.getItem<T>(keys[index])
        if (value !== null) {
          const result = iterator(value, keys[index], index + 1)
          if (result !== undefined) return result
        }
      }
      return undefined
    },
  }
}
