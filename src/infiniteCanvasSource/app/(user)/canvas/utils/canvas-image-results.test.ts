import { describe, expect, it } from 'vitest'
import { CanvasNodeType, type CanvasNodeData } from '../types'
import { applyCanvasImageResults } from './canvas-image-results'

const root: CanvasNodeData = { id: 'root', type: CanvasNodeType.Image, title: '任务', position: { x: 10, y: 20 }, width: 320, height: 320, metadata: { status: 'loading', generationStartedAt: 100, imageTaskRequestFingerprint: 'task-a', imageTaskId: 'id-a', mjRaw: 'false' } }
const images = Array.from({ length: 4 }, (_, index) => ({ url: `https://example.com/${index}.png`, storageKey: `image:${index}`, width: 1600, height: 900, bytes: 100, mimeType: 'image/png' }))

describe('画布单任务多图', () => {
  it.each([3, 4])('实际 %s 张组成批量节点，结果顺序与独立参数完整保留', count => {
    const result = applyCanvasImageResults([root], 'root', images.slice(0, count), { fingerprint: 'task-a' })
    expect(result.nodes).toHaveLength(count + 1)
    expect(result.connections).toHaveLength(count)
    expect(result.nodes[0].metadata).toMatchObject({ isBatchRoot: true, status: 'success', primaryImageId: result.nodes[1].id, batchChildIds: result.nodes.slice(1).map(node => node.id) })
    expect(result.nodes.slice(1).map(node => node.metadata?.content)).toEqual(images.slice(0, count).map(image => image.url))
    for (const node of result.nodes) {
      expect(node.metadata).toMatchObject({ mjRaw: 'false', status: 'success' })
      expect(node.metadata?.imageTaskId).toBeUndefined()
      expect(node.width / node.height).toBeCloseTo(16 / 9)
    }
  })

  it('单图不创建批量节点，手动调整的节点尺寸保持不变', () => {
    const result = applyCanvasImageResults([{ ...root, metadata: { ...root.metadata, manualSize: true } }], 'root', images.slice(0, 1), { startedAt: 100 })
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]).toMatchObject({ width: 320, height: 320, metadata: { isBatchRoot: false } })
    expect(result.connections).toHaveLength(0)
  })

  it('已删除节点、旧任务回调与已完成回调均不重建节点和连线', () => {
    expect(applyCanvasImageResults([], 'root', images, {}).nodes).toEqual([])
    expect(applyCanvasImageResults([root], 'root', images, { fingerprint: 'other' }).nodes).toEqual([root])
    expect(applyCanvasImageResults([root], 'root', images, { startedAt: 200 }).connections).toEqual([])
    const completed = applyCanvasImageResults([root], 'root', images, { startedAt: 100 })
    expect(applyCanvasImageResults(completed.nodes, 'root', images, { startedAt: 100 }).nodes).toBe(completed.nodes)
  })

  it('原结果保存重试成功后清理待保存地址，旧回调不清理新结果', () => {
    const pending = { ...root, metadata: { ...root.metadata, midjourneyResultUrls: images.map(image => image.url) } }
    expect(applyCanvasImageResults([pending], 'root', images, { startedAt: 200 }).nodes[0].metadata?.midjourneyResultUrls).toEqual(pending.metadata.midjourneyResultUrls)
    const completed = applyCanvasImageResults([pending], 'root', images, { startedAt: 100 })
    expect(completed.nodes.every(node => node.metadata?.midjourneyResultUrls === undefined)).toBe(true)
  })
})
