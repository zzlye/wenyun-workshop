import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS, GPT_IMAGE_2_SUPER_MODEL, LOCKED_PUBLIC_PROFILE_ID } from './apiProfiles'
import { callImageApi } from './api'
import { getGenericAssetProxyUrl } from './devProxy'

describe('callImageApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it.each([false, true])(
    'adds the prompt rewrite guard on Responses API when Codex CLI mode is %s',
    async (codexCli) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        output: [{
          type: 'image_generation_call',
          result: 'aW1hZ2U=',
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

      await callImageApi({
        settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses', codexCli },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
      })

      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.input).toBe('Use the following text as the complete prompt. Do not rewrite it:\nprompt')
    },
  )

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

  it('parses Responses API event stream responses without requesting image streaming', async () => {
    const streamBody = [
      'data: {"type":"response.image_generation_call.partial_image","partial_image_index":0,"partial_image_b64":"cGFydGlhbA=="}',
      '',
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"ZmluYWw=","revised_prompt":"rewritten","size":"1024x1024"}]}}',
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
        apiMode: 'responses',
        streamImages: true,
        streamPartialImages: 1,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          apiMode: 'responses',
          streamImages: true,
          streamPartialImages: 1,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onPartialImage: (partial: { image: string }) => partialImages.push(partial.image),
    } as any)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.stream).toBeUndefined()
    expect(body.tools[0].partial_images).toBeUndefined()
    expect(partialImages).toEqual(['data:image/png;base64,cGFydGlhbA=='])
    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
      revisedPrompts: ['rewritten'],
    })
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
    expect(formData.get('stream')).toBeNull()
    expect(formData.get('partial_images')).toBeNull()
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
    expect(String(url)).toBe('https://zzlye.xyz:60/v1/images/generations')
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
    expect(String(url)).toBe('https://zzlye.xyz:60/v1/images/edits')
    expect(init).toMatchObject({ method: 'POST' })
    expect(formData.get('model')).toBe(requestModel)
    expect(formData.get('prompt')).toBe('帮我美化封面')
    expect(formData.get('aspectRatio')).toBe('16:9')
    expect(formData.get('imageSize')).toBe('2K')
    expect(formData.get('replyType')).toBe('json')
    expect(formData.getAll('image[]')).toHaveLength(1)
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
    expect(formData.get('aspectRatio')).toBe('16:9')
    expect(formData.get('imageSize')).toBe('2K')
    expect(formData.get('replyType')).toBe('json')
    expect(formData.getAll('image[]')).toHaveLength(1)
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

  it('parses Responses API image result objects in gallery mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        result: { b64_json: 'ZmluYWw=' },
        size: '1024x1024',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
    })
  })

  it('keeps Responses API stream output item images when completed response omits result', async () => {
    const streamBody = [
      'data: {"type":"response.output_item.done","item":{"id":"img-call-1","type":"image_generation_call","status":"generating","action":"generate","result":"ZmluYWw=","size":"1024x1024"},"output_index":0}',
      '',
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","status":"completed","result":""}]}}',
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
        apiMode: 'responses',
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          apiMode: 'responses',
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
    })
  })

  it('uses the same-origin API proxy path when API proxy is enabled', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uses the same-origin API proxy path when API proxy is enabled and base URL is empty', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: true,
        baseUrl: '',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uses the same-origin API proxy path for sync custom providers', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: '',
        apiKey: 'test-key',
        apiProxy: true,
        customProviders: [{
          id: 'custom-sync',
          name: 'Custom Sync',
          template: 'http-image',
          submit: {
            path: 'custom/images',
            method: 'POST',
            contentType: 'json',
            body: { model: '$profile.model', prompt: '$prompt' },
            result: { b64JsonPaths: ['data.*.b64_json'] },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom-sync',
          provider: 'custom-sync',
          baseUrl: '',
          apiKey: 'test-key',
          model: 'model',
          apiProxy: true,
        }],
        activeProfileId: 'profile-custom-sync',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/custom/images',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('rejects API proxy for async custom providers', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: '',
        apiKey: 'test-key',
        apiProxy: true,
        customProviders: [{
          id: 'custom-async-proxy',
          name: 'Custom Async Proxy',
          template: 'http-image',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            body: { model: '$profile.model', prompt: '$prompt' },
            taskIdPath: 'task_id',
          },
          poll: {
            path: 'images/tasks/{task_id}',
            method: 'GET',
            intervalSeconds: 1,
            statusPath: 'status',
            successValues: ['done'],
            failureValues: ['failed'],
            result: { b64JsonPaths: ['data.*.b64_json'] },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom-async-proxy',
          provider: 'custom-async-proxy',
          baseUrl: '',
          apiKey: 'test-key',
          model: 'model',
          apiProxy: true,
        }],
        activeProfileId: 'profile-custom-async-proxy',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })).rejects.toThrow('异步任务的自定义服务商')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the same-origin API proxy path when API proxy is locked', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: false,
        baseUrl: 'http://api.example.com/v1',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
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

  it('ignores stored API proxy settings when the current deployment has no proxy', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'false')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.example.com/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('polls custom async tasks immediately and keeps polling after transient network errors', async () => {
    vi.useFakeTimers()
    const onCustomTaskEnqueued = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'task-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          status: 'SUCCESS',
          data: {
            data: [{ b64_json: 'aW1hZ2U=' }],
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const promise = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: 'https://api.example.com/v1',
        customProviders: [{
          id: 'custom-async',
          name: 'Custom Async',
          template: 'http-image',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            query: { async: 'true' },
            body: { model: '$profile.model', prompt: '$prompt' },
            taskIdPath: 'task_id',
          },
          poll: {
            path: 'images/tasks/{task_id}',
            method: 'GET',
            intervalSeconds: 1,
            statusPath: 'data.status',
            successValues: ['SUCCESS'],
            failureValues: ['FAILURE'],
            errorPath: 'data.fail_reason',
            result: {
              imageUrlPaths: ['data.data.data.*.url'],
              b64JsonPaths: ['data.data.data.*.b64_json'],
            },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom',
          provider: 'custom-async',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key',
          model: 'model',
          timeout: 60,
        }],
        activeProfileId: 'profile-custom',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onCustomTaskEnqueued,
    })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(onCustomTaskEnqueued).toHaveBeenCalledWith({ taskId: 'task-1' })
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.com/v1/images/tasks/task-1')
    await vi.advanceTimersByTimeAsync(1000)

    await expect(promise).resolves.toEqual({
      images: ['data:image/png;base64,aW1hZ2U='],
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not apply submit timeout to custom async polling after receiving a task id', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'task-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'IN_PROGRESS' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          status: 'SUCCESS',
          data: {
            data: [{ b64_json: 'aW1hZ2U=' }],
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const promise = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: 'https://api.example.com/v1',
        customProviders: [{
          id: 'custom-async',
          name: 'Custom Async',
          template: 'http-image',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            query: { async: 'true' },
            body: { model: '$profile.model', prompt: '$prompt' },
            taskIdPath: 'task_id',
          },
          poll: {
            path: 'images/tasks/{task_id}',
            method: 'GET',
            intervalSeconds: 5,
            statusPath: 'data.status',
            successValues: ['SUCCESS'],
            failureValues: ['FAILURE'],
            result: {
              b64JsonPaths: ['data.data.data.*.b64_json'],
            },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom',
          provider: 'custom-async',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key',
          model: 'model',
          timeout: 1,
        }],
        activeProfileId: 'profile-custom',
        timeout: 1,
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    await vi.advanceTimersByTimeAsync(6000)

    await expect(promise).resolves.toEqual({
      images: ['data:image/png;base64,aW1hZ2U='],
    })
  })
})
