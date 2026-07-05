import { describe, expect, it } from 'vitest'
import { parseModelListPayload } from './modelList'

describe('parseModelListPayload', () => {
  it('reads standard OpenAI compatible model data', () => {
    expect(parseModelListPayload({ data: [{ id: 'gpt-5.5' }, { id: 'grok-imagine-video' }] })).toEqual([
      'gpt-5.5',
      'grok-imagine-video',
    ])
  })

  it('reads nested NewAPI style model lists and json encoded lists', () => {
    expect(parseModelListPayload({
      success: true,
      data: {
        models: JSON.stringify([
          { model_name: 'text-model-a' },
          { name: 'video-model-b' },
        ]),
      },
    })).toEqual(['text-model-a', 'video-model-b'])
  })

  it('puts currently stable video models before Grok video models', () => {
    expect(parseModelListPayload({
      data: [
        { id: 'kling-video-o3-omni' },
        { id: 'grok-imagine-video-1.5-720p' },
        { id: 'grok-imagine-video-1.5-1080p' },
        { id: 'grok-video-3-pro' },
        { id: 'sora-v3-fast' },
        { id: 'veo_3_1-fast' },
        { id: 'veo31-fast' },
        { id: 'sora-2' },
        { id: 'grok-video-3' },
      ],
    })).toEqual(['sora-2', 'sora-v3-fast', 'veo_3_1-fast', 'veo31-fast', 'kling-video-o3-omni', 'grok-imagine-video-1.5-720p', 'grok-imagine-video-1.5-1080p', 'grok-video-3', 'grok-video-3-pro'])
  })
})
