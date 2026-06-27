import { getLockedAssetProxyUrl } from './devProxy'

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const IMAGE_EXTENSION_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export async function getImageSourceBlob(src: string): Promise<Blob> {
  const normalizedSrc = src.trim()
  if (!normalizedSrc) throw new Error('图片地址为空')

  if (normalizedSrc.startsWith('data:')) {
    return dataUrlToBlob(normalizedSrc)
  }

  const response = await fetch(getImageFetchUrl(normalizedSrc), { cache: 'no-store' })
  if (!response.ok) throw new Error(`读取图片失败：HTTP ${response.status}`)

  return withImageMimeType(await response.blob(), normalizedSrc)
}

export function getImageBlobExtension(blob: Blob, fallbackSrc = '') {
  const normalizedType = blob.type.toLowerCase()
  return IMAGE_MIME_EXTENSIONS[normalizedType]
    ?? getImageExtensionFromSource(fallbackSrc)
    ?? normalizedType.split('/')[1]
    ?? 'png'
}

function getImageFetchUrl(src: string) {
  return /^https?:\/\//i.test(src) ? getLockedAssetProxyUrl(src) : src
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;,]+)?((?:;[^,]*)?),(.*)$/s)
  if (!match) throw new Error('图片 data URL 无效')

  const mimeType = match[1] || 'image/png'
  const metadata = match[2] || ''
  const payload = match[3] || ''
  const binary = /;base64/i.test(metadata)
    ? atob(payload.replace(/\s/g, ''))
    : decodeURIComponent(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: mimeType })
}

function withImageMimeType(blob: Blob, src: string) {
  if (blob.type.startsWith('image/')) return blob

  const mimeType = getImageMimeFromSource(src)
  if (!mimeType) return blob
  return new Blob([blob], { type: mimeType })
}

function getImageMimeFromSource(src: string) {
  const extension = getImageExtensionFromSource(src)
  return extension ? IMAGE_EXTENSION_MIME[extension] : undefined
}

function getImageExtensionFromSource(src: string) {
  try {
    const pathname = new URL(src, window.location.href).pathname
    const extension = pathname.split('.').pop()?.toLowerCase()
    return extension && IMAGE_EXTENSION_MIME[extension] ? extension : undefined
  } catch {
    const extension = src.split('?')[0]?.split('#')[0]?.split('.').pop()?.toLowerCase()
    return extension && IMAGE_EXTENSION_MIME[extension] ? extension : undefined
  }
}
