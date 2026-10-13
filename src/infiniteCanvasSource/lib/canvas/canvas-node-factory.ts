import type { UploadedImage } from '@/services/image-storage';
import type { CanvasNodeMetadata } from '@/app/(user)/canvas/types';

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, naturalWidth: image.width,
        naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType, status: 'success' };
}
