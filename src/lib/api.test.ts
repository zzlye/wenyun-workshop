import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS, GPT_IMAGE_2_SUPER_MODEL, LOCKED_PUBLIC_PROFILE_ID, getActiveApiProfile } from './apiProfiles'
import { callImageApi } from './api'
import { getGenericAssetProxyUrl } from './devProxy'

describe('callImageApi', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('测试未配置网络响应'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'disabled')
    vi.useRealTimers()
  })

  it('records actual params returned on Images API responses in Codex CLI mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
      data: [{
        b64_json: 'aW1hZ2U=',
        revised_prompt: '移除靴子',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.actualParams).toEqual({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    })
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    }])
    expect(result.revisedPrompts).toEqual(['移除靴子'])
  })

  it('does not synthesize actual quality in Codex CLI mode when the API omits it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_format: 'png',
      size: '1033x1522',
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result.actualParams).toEqual({
      output_format: 'png',
      size: '1033x1522',
    })
    expect(result.actualParams?.quality).toBeUndefined()
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      size: '1033x1522',
    }])
  })

  it('parses Images API event stream responses without requesting image streaming', async () => {
    const streamBody = [
      'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"cGFydGlhbA=="}',
      '',
      'data: {"type":"image_generation.completed","b64_json":"ZmluYWw=","size":"1024x1024","quality":"high","output_format":"png"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const partialImages: string[] = []

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        streamImages: true,
        streamPartialImages: 3,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          streamImages: true,
          streamPartialImages: 3,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onPartialImage: (partial: { image: string }) => partialImages.push(partial.image),
    } as any)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({
      model: DEFAULT_SETTINGS.model,
    })
    expect(body.stream).toBeUndefined()
    expect(body.partial_images).toBeUndefined()
    expect(partialImages).toEqual(['data:image/png;base64,cGFydGlhbA=='])
    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: {
        output_format: 'png',
        quality: 'high',
        size: '1024x1024',
      },
      actualParamsList: [{
        output_format: 'png',
        quality: 'high',
        size: '1024x1024',
      }],
    })
  })

  it('does not expect revised prompts on official Images API stream completed events', async () => {
    const streamBody = [
      'data: {"created_at":1779112721,"type":"image_generation.completed","b64_json":"ZmluYWw=","background":"opaque","output_format":"jpeg","quality":"medium","sequence_number":0,"size":"1448x1086","usage":{"total_tokens":1569}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: {
        output_format: 'jpeg',
        quality: 'medium',
        size: '1448x1086',
      },
      revisedPrompts: [undefined],
    })
  })

  it('parses Images API stream result events with data b64_json', async () => {
    const streamBody = [
      'data: {"object":"image.generation.chunk","created":1779551054,"model":"gpt-image-2"}',
      '',
      'data: {"object":"image.generation.result","created":1779551140,"model":"gpt-image-2","data":[{"b64_json":"ZmluYWw=","revised_prompt":"rewritten"}],"size":"1024x1536","quality":"medium","output_format":"png"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: {
        output_format: 'png',
        quality: 'medium',
        size: '1024x1536',
      },
      actualParamsList: [{
        output_format: 'png',
        quality: 'medium',
        size: '1024x1536',
      }],
      revisedPrompts: ['rewritten'],
    })
  })

  it('keeps Images API multi-image requests batched when saved streaming flags are migrated off', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [
        { b64_json: 'Zmlyc3Q=' },
        { b64_json: 'c2Vjb25k=' },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const partials: Array<{ image: string; requestIndex?: number }> = []

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        streamImages: true,
        streamPartialImages: 1,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          streamImages: true,
          streamPartialImages: 1,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 2 },
      inputImageDataUrls: [],
      onPartialImage: (partial: { image: string; requestIndex?: number }) => partials.push(partial),
    } as any)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.n).toBe(2)
    expect(body.stream).toBeUndefined()
    expect(body.partial_images).toBeUndefined()
    expect(result.images).toHaveLength(2)
    expect(result.images).toEqual([
      'data:image/png;base64,Zmlyc3Q=',
      'data:image/png;base64,c2Vjb25k=',
    ])
    expect(partials).toEqual([])
  })

  it('routes fixed GPT Image 2 super model through the 4K request model', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      data: [{ b64_json: 'ZmluYWw=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      model: GPT_IMAGE_2_SUPER_MODEL,
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        apiKey: 'test-key',
        model: GPT_IMAGE_2_SUPER_MODEL,
        responseFormatB64Json: false,
      })),
    }

    await callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({
      model: 'gpt-image-2-4k',
      prompt: 'prompt',
      size: DEFAULT_PARAMS.size,
      response_format: 'b64_json',
    })
  })

  it('keeps the new fixed GPT Image 2 4K model on the 4K request model', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      data: [{ b64_json: 'ZmluYWw=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      model: 'gpt-image-2-4k',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        apiKey: 'test-key',
        model: 'gpt-image-2-4k',
      })),
    }

    await callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({
      model: 'gpt-image-2-4k',
      prompt: 'prompt',
      size: DEFAULT_PARAMS.size,
    })
  })

  it('does not send streaming fields on GPT Image 2 4K image edits', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('data:')) return new Response(new Blob(['ref'], { type: 'image/png' }))
      return new Response(JSON.stringify({
        data: [{ b64_json: 'ZWRpdGVk' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      model: 'gpt-image-2-4k',
      streamImages: true,
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        apiKey: 'test-key',
        model: 'gpt-image-2-4k',
        streamImages: true,
        responseFormatB64Json: false,
      })),
    }

    await callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '3840x2160' },
      inputImageDataUrls: ['data:image/png;base64,cmVm'],
    } as any)

    const apiCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/images/edits'))
    expect(apiCall).toBeTruthy()
    const [, init] = apiCall!
    const formData = (init as RequestInit).body as FormData
    expect(formData.get('model')).toBe('gpt-image-2-4k')
    expect(formData.get('size')).toBe('3840x2160')
    expect(formData.get('response_format')).toBe('b64_json')
    expect(formData.get('stream')).toBeNull()
    expect(formData.get('partial_images')).toBeNull()
  })

  it('文运站通过异步任务短轮询获取图片结果', async () => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        taskId: 'task-1',
        accessToken: 'token-1',
        status: 'running',
      }), { status: 202, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: 'task-1', status: 'succeeded' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'ZmluYWw=' }] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Wenyun-Upstream-Status': '200',
        },
      }))
    const onImageTaskCreated = vi.fn()

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({ ...profile, apiKey: 'test-key' })),
    }
    const result = await callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      imageTask: { taskId: '', accessToken: '', idempotencyKey: 'home-task-1' },
      onImageTaskCreated,
    })

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/image-tasks?endpoint=%2Fimages%2Fgenerations',
      '/image-tasks/task-1',
      '/image-tasks/task-1/result',
    ])
    expect(onImageTaskCreated).toHaveBeenCalledWith({ taskId: 'task-1', accessToken: 'token-1', idempotencyKey: 'home-task-1' })
    expect(result.images).toEqual(['data:image/png;base64,ZmluYWw='])
  })

  it('文运站图生图通过异步任务入口提交 edits 并复用任务凭据', async () => {
    vi.stubEnv('VITE_IMAGE_TASKS_AVAILABLE', 'enabled')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('data:')) return new Response(new Blob(['ref'], { type: 'image/png' }))
      if (url.startsWith('/image-tasks?')) {
        return new Response(JSON.stringify({
          taskId: 'edit-task-1',
          accessToken: 'edit-token-1',
          status: 'pending',
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/result')) {
        return new Response(JSON.stringify({ data: [{ b64_json: 'ZWRpdC1maW5hbA==' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ taskId: 'edit-task-1', status: 'succeeded' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const onImageTaskCreated = vi.fn()

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({ ...profile, apiKey: 'test-key' })),
    }
    const result = await callImageApi({
      settings,
      prompt: '保留主体并替换背景',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: ['data:image/png;base64,cmVm'],
      imageTask: { taskId: '', accessToken: '', idempotencyKey: 'home-edit-task-1' },
      onImageTaskCreated,
    })

    const createCall = fetchMock.mock.calls.find(([input]) => String(input).startsWith('/image-tasks?'))
    expect(createCall).toBeTruthy()
    const [url, init] = createCall!
    expect(String(url)).toBe('/image-tasks?endpoint=%2Fimages%2Fedits')
    expect(init).toMatchObject({ method: 'POST' })
    const formData = (init as RequestInit).body as FormData
    expect(formData.get('model')).toBe('gpt-image-2')
    expect(formData.get('prompt')).toBe('保留主体并替换背景')
    expect(formData.getAll('image')).toHaveLength(1)
    expect(formData.get('mask')).toBeNull()
    expect(new Headers((init as RequestInit).headers).get('x-wenyun-idempotency-key')).toBe('home-edit-task-1')
    expect(onImageTaskCreated).toHaveBeenCalledWith({
      taskId: 'edit-task-1',
      accessToken: 'edit-token-1',
      idempotencyKey: 'home-edit-task-1',
    })
    expect(result.images).toEqual(['data:image/png;base64,ZWRpdC1maW5hbA=='])
  })

  it('按公开文档提交文运站图生图且不发送 mask', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('data:')) return new Response(new Blob(['ref'], { type: 'image/png' }))
      return new Response(JSON.stringify({
        data: [{ b64_json: 'ZWRpdGVk' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        apiKey: 'test-key',
      })),
    }

    await callImageApi({
      settings,
      prompt: '保留主体并修改背景',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: ['data:image/png;base64,cmVm'],
      maskDataUrl: 'data:image/png;base64,bWFzaw==',
    } as any)

    const apiCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/images/edits'))
    expect(apiCall).toBeTruthy()
    const [, init] = apiCall!
    const formData = (init as RequestInit).body as FormData
    expect(formData.getAll('image')).toHaveLength(1)
    expect(formData.get('image[]')).toBeNull()
    expect(formData.get('mask')).toBeNull()
    expect(formData.get('quality')).toBeNull()
    expect(formData.get('output_format')).toBeNull()
    expect(formData.get('output_compression')).toBeNull()
    expect(formData.get('moderation')).toBeNull()
  })

  it('routes Banana image models through standard NewAPI image generations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      data: [{ b64_json: 'ZmluYWw=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      model: 'Nano-Banana-Pro',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        apiKey: 'test-key',
        model: 'Nano-Banana-Pro',
      })),
    }

    const result = await callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(String(url)).toBe('https://api.zzlye.xyz/v1/images/generations')
    expect(body).toMatchObject({
      model: 'nano-banana-pro',
      size: DEFAULT_PARAMS.size,
      aspectRatio: '1:1',
      imageSize: '1K',
      replyType: 'json',
      prompt: 'prompt',
    })
    expect(result.images).toEqual(['data:image/png;base64,ZmluYWw='])
  })

  it('automatically switches Banana protocol when the first format is rejected', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'not supported model for image generation, only imagen models are supported' },
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'YXV0bw==' } }] },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'auto-format-test-key',
      apiFormat: 'auto' as const,
      model: 'Nano-Banana-Pro',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        baseUrl: 'https://auto-format.example.com/v1',
        apiKey: 'auto-format-test-key',
        apiFormat: 'auto' as const,
        model: 'Nano-Banana-Pro',
        apiProxy: false,
      })),
    }

    expect(getActiveApiProfile(settings).apiFormat).toBe('auto')
    expect(getActiveApiProfile(settings).model).toMatch(/^Nano-Banana/)

    const result = await callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.zzlye.xyz/v1/images/generations')
    expect(String(fetchMock.mock.calls[1][0])).toBe('/newapi-proxy/wenyun/v1beta/models/nano-banana-pro:generateContent')
    expect(result.images).toEqual(['data:image/png;base64,YXV0bw=='])
  })

  it('parses Banana images returned as Markdown links inside Gemini text parts without re-sending', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      // 网关把只支持 OpenAI 对话接口的渠道结果转成 Gemini 结构时，图片只会以 Markdown 链接出现在 text 里。
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{
          content: { role: 'model', parts: [{ text: '已生成：![image](https://cdn.example.com/out/1.png)' }] },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      // 第二次 fetch 是浏览器下载图片链接。
      .mockResolvedValueOnce(new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }))

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'markdown-text-key',
      apiFormat: 'gemini' as const,
      model: 'Nano-Banana-2',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        baseUrl: 'https://markdown-text.example.com/v1',
        apiKey: 'markdown-text-key',
        apiFormat: 'gemini' as const,
        model: 'Nano-Banana-2',
        apiProxy: false,
      })),
    }

    const result = await callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    // 只发了一次生成请求，没有换协议重发（避免上游重复计费）。
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes(':generateContent'))).toHaveLength(1)
    expect(result.images).toHaveLength(1)
    expect(result.images[0]).toMatch(/^data:image\/png;base64,/)
    expect(result.rawImageUrls).toEqual(['https://cdn.example.com/out/1.png'])
  })

  it('switches a remembered Gemini protocol back to OpenAI when the channel returns no image data', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      // 第一次：OpenAI 协议被拒绝，自动切到 Gemini 并记住。
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'not supported model for image generation, only imagen models are supported' },
      }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'Zmlyc3Q=' } }] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      // 第二次：站点后端换成只兼容 OpenAI 的渠道，Gemini 协议返回 200 但没有任何图片。
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [{ text: '好的，这是您要的图片。' }] }, finishReason: 'STOP' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ b64_json: 'c2Vjb25k' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      // 第三次：应直接使用记住的 OpenAI 协议。
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ b64_json: 'dGhpcmQ=' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'channel-switch-key',
      apiFormat: 'auto' as const,
      model: 'Nano-Banana-2',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        baseUrl: 'https://channel-switch.example.com/v1',
        apiKey: 'channel-switch-key',
        apiFormat: 'auto' as const,
        model: 'Nano-Banana-2',
        apiProxy: false,
      })),
    }
    const call = () => callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    const first = await call()
    expect(first.images).toEqual(['data:image/png;base64,Zmlyc3Q='])
    expect(String(fetchMock.mock.calls[1][0])).toContain(':generateContent')

    const second = await call()
    expect(second.images).toEqual(['data:image/png;base64,c2Vjb25k'])
    expect(String(fetchMock.mock.calls[2][0])).toContain(':generateContent')
    expect(String(fetchMock.mock.calls[3][0])).toContain('/images/generations')

    const third = await call()
    expect(third.images).toEqual(['data:image/png;base64,dGhpcmQ='])
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(String(fetchMock.mock.calls[4][0])).toContain('/images/generations')
  })

  it('reports both protocol errors when Banana auto mode fails on both formats', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'no image' }] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'both-fail-key',
      apiFormat: 'auto' as const,
      model: 'Nano-Banana-2',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        baseUrl: 'https://both-fail.example.com/v1',
        apiKey: 'both-fail-key',
        apiFormat: 'auto' as const,
        model: 'Nano-Banana-2',
        apiProxy: false,
      })),
    }

    await expect(callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)).rejects.toThrow(/OpenAI 协议：[\s\S]*Gemini 协议：/)
  })

  it('routes Banana image models through native Gemini generateContent when selected', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [
            { text: '已生成图片' },
            { inlineData: { mimeType: 'image/png', data: 'Z2VtaW5p' } },
          ],
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      apiFormat: 'gemini' as const,
      model: 'Nano-Banana-Pro',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        apiKey: 'test-key',
        apiFormat: 'gemini' as const,
        model: 'Nano-Banana-Pro',
      })),
    }

    const result = await callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '2560x1440' },
      inputImageDataUrls: ['data:image/jpeg;base64,cmVm'],
    } as any)

    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(String(url)).toBe('/newapi-proxy/wenyun/v1beta/models/nano-banana-pro:generateContent')
    expect(body).toEqual({
      contents: [{
        role: 'user',
        parts: [
          { text: 'prompt' },
          { inlineData: { mimeType: 'image/jpeg', data: 'cmVm' } },
        ],
      }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
      },
    })
    expect(init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer test-key',
        'x-goog-api-key': 'test-key',
      }),
    })
    expect(result.images).toEqual(['data:image/png;base64,Z2VtaW5p'])
  })

  it('adds Banana native image size fields to NewAPI requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'ZmluYWw=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      model: 'Nano-Banana-2',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        apiKey: 'test-key',
        model: 'Nano-Banana-2',
      })),
    }

    await callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '3840x2160' },
      inputImageDataUrls: [],
    } as any)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.model).toBe('nano-banana-2')
    expect(body.size).toBe('3840x2160')
    expect(body.aspectRatio).toBe('16:9')
    expect(body.imageSize).toBe('4K')
    expect(body.replyType).toBe('json')
  })

  it.each([
    ['1:1', '1:1', '1K'],
    ['3:2', '3:2', '1K'],
    ['2:3', '2:3', '1K'],
    ['4:3', '4:3', '1K'],
    ['3:4', '3:4', '1K'],
    ['16:9', '16:9', '1K'],
    ['9:16', '9:16', '1K'],
    ['2048x2048', '1:1', '2K'],
    ['2560x1440', '16:9', '2K'],
    ['1440x2560', '9:16', '2K'],
    ['2880x2880', '1:1', '4K'],
    ['3840x2160', '16:9', '4K'],
    ['2160x3840', '9:16', '4K'],
    ['928x1152', '4:5', '1K'],
    ['2752x1536', '16:9', '2K'],
    ['4096x4096', '1:1', '4K'],
    ['6336x2688', '21:9', '4K'],
  ])('maps Banana size %s to native aspect and tier', async (
    size,
    expectedAspectRatio,
    expectedImageSize,
  ) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'ZmluYWw=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      model: 'Nano-Banana-Pro',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        apiKey: 'test-key',
        model: 'Nano-Banana-Pro',
      })),
    }

    await callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size },
      inputImageDataUrls: [],
    } as any)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.aspectRatio).toBe(expectedAspectRatio)
    expect(body.imageSize).toBe(expectedImageSize)
  })

  it.each([
    ['文运站 Banana 2', 'Nano-Banana-2', 'nano-banana-2'],
    ['文运站 Banana Pro', 'Nano-Banana-Pro', 'nano-banana-pro'],
  ])('routes %s image edits through standard NewAPI edits like public site', async (
    _label,
    model,
    requestModel,
  ) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('data:')) return new Response(new Blob(['ref'], { type: 'image/png' }))
      return new Response(JSON.stringify({
        data: [{ b64_json: 'ZWRpdGVk' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      model,
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        apiKey: 'test-key',
        model,
      })),
    }

    const result = await callImageApi({
      settings,
      prompt: '帮我美化封面',
      params: { ...DEFAULT_PARAMS, size: '2560x1440' },
      inputImageDataUrls: ['data:image/png;base64,cmVm'],
    } as any)

    const apiCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/images/edits'))
    expect(apiCall).toBeTruthy()
    const [url, init] = apiCall!
    const formData = (init as RequestInit).body as FormData
    expect(String(url)).toBe('https://api.zzlye.xyz/v1/images/edits')
    expect(init).toMatchObject({ method: 'POST' })
    expect(formData.get('model')).toBe(requestModel)
    expect(formData.get('prompt')).toBe('帮我美化封面')
    expect(formData.get('aspectRatio')).toBeNull()
    expect(formData.get('imageSize')).toBeNull()
    expect(formData.get('replyType')).toBeNull()
    expect(formData.getAll('image')).toHaveLength(1)
    expect(result.images).toEqual(['data:image/png;base64,ZWRpdGVk'])
  })

  it.each([
    ['公益站 Banana 2', 'Nano-Banana-2', 'nano-banana-2'],
    ['公益站 Banana Pro', 'Nano-Banana-Pro', 'nano-banana-pro'],
  ])('routes %s image edits through standard NewAPI edits without changing site URL', async (
    _label,
    model,
    requestModel,
  ) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('data:')) return new Response(new Blob(['ref'], { type: 'image/png' }))
      return new Response(JSON.stringify({
        data: [{ b64_json: 'ZWRpdGVk' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      model,
      activeProfileId: LOCKED_PUBLIC_PROFILE_ID,
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        apiKey: 'test-key',
        model,
      })),
    }

    const result = await callImageApi({
      settings,
      prompt: '帮我美化封面',
      params: { ...DEFAULT_PARAMS, size: '2560x1440' },
      inputImageDataUrls: ['data:image/png;base64,cmVm'],
    } as any)

    const apiCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/images/edits'))
    expect(apiCall).toBeTruthy()
    const [url, init] = apiCall!
    const formData = (init as RequestInit).body as FormData
    expect(String(url)).toBe('https://1520635.xyz:3901/v1/images/edits')
    expect(init).toMatchObject({ method: 'POST' })
    expect(formData.get('model')).toBe(requestModel)
    expect(formData.get('prompt')).toBe('帮我美化封面')
    expect(formData.get('aspectRatio')).toBeNull()
    expect(formData.get('imageSize')).toBeNull()
    expect(formData.get('replyType')).toBeNull()
    expect(formData.getAll('image')).toHaveLength(1)
    expect(result.images).toEqual(['data:image/png;base64,ZWRpdGVk'])
  })

  it('parses Grsai Banana native result URLs relayed by NewAPI custom channels', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'task-1',
      status: 'succeeded',
      results: [{ url: 'data:image/png;base64,ZmluYWw=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      model: 'Nano-Banana-2',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        apiKey: 'test-key',
        model: 'Nano-Banana-2',
      })),
    }

    const result = await callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '3840x2160' },
      inputImageDataUrls: [],
    } as any)

    expect(result.images).toEqual(['data:image/png;base64,ZmluYWw='])
  })

  it('keeps Banana remote result URLs when browser-side image download fails', async () => {
    const imageUrl = 'https://file.example.com/final.png'
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task-1',
        status: 'succeeded',
        results: [{ url: imageUrl }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const settings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      model: 'Nano-Banana-2',
      profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
        ...profile,
        apiKey: 'test-key',
        model: 'Nano-Banana-2',
      })),
    }

    const result = await callImageApi({
      settings,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '3840x2160' },
      inputImageDataUrls: [],
    } as any)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.images).toEqual([getGenericAssetProxyUrl(imageUrl)])
    expect(result.rawImageUrls).toEqual([imageUrl])
  })

  it('extends Image-2 4K request timeout instead of aborting at the short configured timeout', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      signal = (init as RequestInit).signal as AbortSignal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })

    const promise = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        model: 'gpt-image-2-4k',
        timeout: 1,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          model: 'gpt-image-2-4k',
          timeout: 1,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '3840x2160' },
      inputImageDataUrls: [],
    } as any)
    const handledPromise = promise.catch((error) => error)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(1000)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(899000)
    expect(signal?.aborted).toBe(true)
    await expect(handledPromise).resolves.toBeInstanceOf(Error)
  })

  it('does not add cache request headers that require extra CORS allow-list entries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers).not.toHaveProperty('Pragma')
    expect(headers).not.toHaveProperty('Cache-Control')
    expect((init as RequestInit).cache).toBe('no-store')
  })

})
