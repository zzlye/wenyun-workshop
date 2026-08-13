import type { Position } from "../types";

export type DroppedCanvasNodeSize = {
    width: number;
    height: number;
};

const DEFAULT_DROP_GAP = 36;
const DEFAULT_MAX_COLUMNS = 3;

export function layoutDroppedCanvasNodes(
    anchor: Position,
    sizes: DroppedCanvasNodeSize[],
    gap = DEFAULT_DROP_GAP,
    maxColumns = DEFAULT_MAX_COLUMNS,
): Position[] {
    if (!sizes.length) return [];

    const columns = Math.max(1, Math.min(maxColumns, Math.ceil(Math.sqrt(sizes.length))));
    const rows = Math.ceil(sizes.length / columns);
    const columnWidths = Array.from({ length: columns }, () => 0);
    const rowHeights = Array.from({ length: rows }, () => 0);

    sizes.forEach((size, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        columnWidths[column] = Math.max(columnWidths[column], Math.max(1, size.width));
        rowHeights[row] = Math.max(rowHeights[row], Math.max(1, size.height));
    });

    const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, columns - 1);
    const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0) + gap * Math.max(0, rows - 1);
    const columnOffsets: number[] = [];
    const rowOffsets: number[] = [];
    let offset = 0;
    columnWidths.forEach((width) => {
        columnOffsets.push(offset);
        offset += width + gap;
    });
    offset = 0;
    rowHeights.forEach((height) => {
        rowOffsets.push(offset);
        offset += height + gap;
    });

    // 每个文件占据自己的网格单元，尺寸不同的图片也不会互相覆盖。
    return sizes.map((size, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
            x: anchor.x - totalWidth / 2 + columnOffsets[column] + (columnWidths[column] - size.width) / 2,
            y: anchor.y - totalHeight / 2 + rowOffsets[row] + (rowHeights[row] - size.height) / 2,
        };
    });
}
