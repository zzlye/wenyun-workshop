import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyImageSourceToClipboard } from './clipboard'

const originalClipboardItem = globalThis.ClipboardItem
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

class MockClipboardItem {
  static supports(type: string) {
    return type === 'image/png'
  }

  items: Record<string, Blob | Promise<Blob>>

  constructor(items: Record<string, Blob | Promise<Blob>>) {
    this.items = items
  }
}

describe('clipboard image copy', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: originalClipboardItem })
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'navigator')
    }
  })

  it('starts clipboard write before a large remote image finishes downloading', async () => {
    let resolveFetch: (response: Response) => void = () => {}
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const write = vi.fn(async (items: MockClipboardItem[]) => {
      await Promise.all(Object.values(items[0].items))
    })

    vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchPromise as Promise<Response>)
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: MockClipboardItem })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { write } },
    })

    const copyPromise = copyImageSourceToClipboard('https://example.com/large-4k.png')

    expect(write).toHaveBeenCalledTimes(1)

    resolveFetch(new Response(new Blob(['image'], { type: 'image/png' })))
    await copyPromise
  })
})
