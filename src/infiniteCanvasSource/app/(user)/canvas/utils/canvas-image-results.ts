import { nanoid } from 'nanoid'
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from '../types'
import { NODE_DEFAULT_SIZE } from '../constants'
import { fitNodeSize } from './canvas-node-size'

type ImageResult = { url: string; storageKey: string; width: number; height: number; bytes: number; mimeType: string }

/** 一次任务的全部单图组成现有批量节点，封面不占结果数量。过期回调不能恢复已删除的节点。 */
export function applyCanvasImageResults(nodes: CanvasNodeData[], nodeId: string, images: ImageResult[], expected: { fingerprint?: string; startedAt?: number }, metadata: CanvasNodeMetadata = {}) {
    const root = nodes.find(node => node.id === nodeId)
    if (!root || root.metadata?.status !== 'loading' || !images.length
        || (expected.fingerprint && root.metadata?.imageTaskRequestFingerprint !== expected.fingerprint)
        || (expected.startedAt !== undefined && root.metadata?.generationStartedAt !== expected.startedAt)) return { nodes, connections: [] as CanvasConnection[] }
    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Image]
    const batch = images.length > 1
    const ids = batch ? images.map(() => nanoid()) : []
    const resultMetadata = (image: ImageResult): CanvasNodeMetadata => ({
        ...metadata, content: image.url, storageKey: image.storageKey, naturalWidth: image.width, naturalHeight: image.height,
        bytes: image.bytes, mimeType: image.mimeType, status: 'success', errorDetails: undefined,
        imageTaskId: undefined, imageTaskAccessToken: undefined, imageTaskIdempotencyKey: undefined,
        imageTaskRequestFingerprint: undefined, imageTaskApiProfileId: undefined,
        midjourneyResultUrls: undefined,
    })
    const size = fitNodeSize(images[0].width, images[0].height, spec.width, spec.height)
    const updated = { ...root, ...(root.metadata?.manualSize ? {} : {
        ...size, position: { x: root.position.x + root.width / 2 - size.width / 2, y: root.position.y + root.height / 2 - size.height / 2 },
    }), metadata: { ...root.metadata, ...resultMetadata(images[0]), isBatchRoot: batch, batchChildIds: batch ? ids : undefined, primaryImageId: ids[0] || root.id, imageBatchExpanded: batch ? true : undefined } }
    const children: CanvasNodeData[] = batch ? images.map((image, index) => ({
        id: ids[index], type: CanvasNodeType.Image, title: root.title,
        position: { x: updated.position.x + updated.width + 120 + (index % 2) * (spec.width + 36), y: updated.position.y + Math.floor(index / 2) * (spec.height + 36) },
        ...fitNodeSize(image.width, image.height, spec.width, spec.height),
        metadata: { ...root.metadata, ...resultMetadata(image), isBatchRoot: false, batchChildIds: undefined, primaryImageId: undefined, imageBatchExpanded: undefined, batchRootId: root.id },
    })) : []
    return { nodes: [...nodes.map(node => node.id === nodeId ? updated : node), ...children], connections: ids.map(id => ({ id: nanoid(), fromNodeId: root.id, toNodeId: id })) }
}
