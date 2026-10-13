// 对话记录只保存小预览，原图仍由素材库保存，发送附件时使用完整原图。
export async function resizeAgentPreview(dataUrl: string, targetLongEdge: number) {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const scale = Math.min(1, targetLongEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建图片预览');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
}
