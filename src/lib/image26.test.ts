import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskParams } from '../types'
import { DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { callImageApi } from './api'
import { getChangedParams, normalizeParamsForSettings } from './paramCompatibility'
import { getImageBlobExtension, getImageSourceBlob } from './imageTransfer'
import * as canvasImage from './canvasImage'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const settingsFor = (model: string) => normalizeSettings({ ...DEFAULT_SETTINGS, profiles: DEFAULT_SETTINGS.profiles.map(profile => ({ ...profile, model, apiKey: 'test-only', apiMode: 'responses' })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('二点六生成、编辑及原始格式', () => {
  it.each(['渠道gpt-image-2.6-flare官渠', 'PREFIXgpt-image-2.6-sunburstSUFFIX'])('%s 保留渠道名，强制图片协议并传递完整参数', async model => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: 'eA==' }] })))
    await callImageApi({ settings: settingsFor(model), prompt: '测试', params: { ...DEFAULT_PARAMS, size: '3840x2160', quality: 'max', complexity: 'low', background: 'transparent', output_format: 'webp', output_compression: 0, moderation: 'low' }, inputImageDataUrls: [] })
    expect(String(fetch.mock.calls[0][0])).toContain('/images/generations')
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ model, size: '3840x2160', quality: 'max', complexity: 'low', output_compression: 0, background: 'transparent', moderation: 'low' })
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).not.toHaveProperty('response_format')
  })

  it.each(['svg', 'gif'] as const)('%s 经异步任务返回后保留文件字节及扩展名', async format => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
    const bytes = format === 'svg' ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>' : 'GIF89a'
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'image26-task', accessToken: 'test-token', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'image26-task', status: 'succeeded' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: btoa(bytes) }], output_format: format })))
    const result = await callImageApi({ settings: settingsFor('gpt-image-2.6-flare'), prompt: '动画图标', params: { ...DEFAULT_PARAMS, output_format: format, size: '256x256', n: 3, complexity: 'medium', output_compression: 60, frame_count: 12, frame_duration_ms: 205 }, inputImageDataUrls: [], imageTask: { taskId: '', accessToken: '', idempotencyKey: 'image26-test' } })
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
    expect(body).not.toHaveProperty('output_compression')
    expect(body).not.toHaveProperty('stream')
    if (format === 'svg') { expect(body.n).toBe(1); expect(body).not.toHaveProperty('frame_count') }
    else expect(body).toMatchObject({ frame_count: 12, frame_duration_ms: 210, size: '256x256' })
    const blob = await getImageSourceBlob(result.images[0])
    expect(getImageBlobExtension(blob)).toBe(format)
    expect(await blob.text()).toBe(bytes)
  })

  it('标注独立上传为 markup，主图不压缩，旧 SVG 输出在编辑时回到 PNG', async () => {
    const primary = await canvasImage.dataUrlToBlob(png)
    vi.spyOn(canvasImage, 'validateMarkupMatchesImage').mockResolvedValue()
    const convert = vi.spyOn(canvasImage, 'imageDataUrlToPngBlob').mockResolvedValue(primary)
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: 'eA==' }] })))
    await callImageApi({ settings: settingsFor('abcgpt-image-2.6-sunburst专线'), prompt: '修改圈内文字', params: { ...DEFAULT_PARAMS, complexity: 'high', output_format: 'svg' }, inputImageDataUrls: [png], markupDataUrl: png })
    const form = fetch.mock.calls[0][1]?.body as FormData
    expect(String(fetch.mock.calls[0][0])).toContain('/images/edits')
    expect(form.get('markup')).toBeInstanceOf(Blob)
    expect(form.get('mask')).toBeNull()
    expect(form.get('output_format')).toBe('png')
    expect(form.get('complexity')).toBe('high')
    expect(convert).toHaveBeenCalledWith(png)
  })

  it('标注与遮罩同时提交会在网络请求前拒绝', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(callImageApi({ settings: settingsFor('gpt-image-2.6-flare'), prompt: '编辑', params: DEFAULT_PARAMS, inputImageDataUrls: [png], maskDataUrl: png, markupDataUrl: png })).rejects.toThrow('不能同时使用')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['nano-banana-pro', 'gpt-image-2', 'midjourney'])('切换到 %s 后不能静默丢弃标注', async model => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(callImageApi({ settings: settingsFor(model), prompt: '编辑', params: DEFAULT_PARAMS, inputImageDataUrls: [png], markupDataUrl: png })).rejects.toThrow('标注编辑')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('切换模型清理二点六残留参数，添加参考图清理生成专属格式', () => {
    const original: TaskParams = { ...DEFAULT_PARAMS, output_format: 'gif', complexity: 'low', frame_count: 9, frame_duration_ms: 200 }
    const normalized = normalizeParamsForSettings(original, settingsFor('gpt-image-2'))
    expect(normalized.output_format).toBe('png')
    expect(getChangedParams(original, normalized)).toMatchObject({ complexity: undefined, frame_count: undefined, frame_duration_ms: undefined })
    expect(normalizeParamsForSettings(original, settingsFor('gpt-image-2.6-flare'), { hasInputImages: true }).output_format).toBe('png')
    expect(normalizeParamsForSettings({ ...original, size: '256x256' }, settingsFor('gpt-image-2.6-flare')).size).toBe('256x256')
  })
})
