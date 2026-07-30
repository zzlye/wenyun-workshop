import { describe, expect, it } from 'vitest'
import { parseModelListPayload } from './modelList'
import { CANVAS_VIDEO_MODEL } from './videoModel'

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

  it('优先显示画布当前支持的 Seedance 2.0 模型', () => {
    expect(parseModelListPayload({
      data: [
        { id: 'kling-video-o3-omni' },
        { id: CANVAS_VIDEO_MODEL },
        { id: 'sora-v3-fast' },
      ],
    })).toEqual([CANVAS_VIDEO_MODEL, 'kling-video-o3-omni', 'sora-v3-fast'])
  })
})
