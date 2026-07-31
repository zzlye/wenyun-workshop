import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";

export type CanvasViewportSize = {
    width: number;
    height: number;
};

export type CanvasWorldBounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

export type ConnectionPathGeometry = {
    path: string;
    bounds: CanvasWorldBounds;
};

export const CANVAS_VIEWPORT_PADDING = 280;

export function getCanvasViewportBounds(viewport: ViewportTransform, size: CanvasViewportSize, padding = CANVAS_VIEWPORT_PADDING): CanvasWorldBounds {
    const scale = Math.max(viewport.k, 0.0001);
    const left = -viewport.x / scale - padding;
    const top = -viewport.y / scale - padding;

    return {
        left,
        top,
        right: left + size.width / scale + padding * 2,
        bottom: top + size.height / scale + padding * 2,
    };
}

export function isCanvasNodeVisible(node: CanvasNodeData, bounds: CanvasWorldBounds) {
    return node.position.x + node.width > bounds.left && node.position.x < bounds.right && node.position.y + node.height > bounds.top && node.position.y < bounds.bottom;
}

export function getVisibleCanvasNodes(nodes: CanvasNodeData[], bounds: CanvasWorldBounds, isHidden?: (node: CanvasNodeData) => boolean) {
    return nodes.filter((node) => !isHidden?.(node) && isCanvasNodeVisible(node, bounds));
}

export function getConnectionPathGeometry(from: CanvasNodeData, to: CanvasNodeData): ConnectionPathGeometry {
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
    const controlStartX = startX + curvature;
    const controlEndX = endX - curvature;

    return {
        path: `M ${startX} ${startY} C ${controlStartX} ${startY}, ${controlEndX} ${endY}, ${endX} ${endY}`,
        bounds: {
            left: Math.min(startX, endX, controlStartX, controlEndX),
            top: Math.min(startY, endY),
            right: Math.max(startX, endX, controlStartX, controlEndX),
            bottom: Math.max(startY, endY),
        },
    };
}

export function isCanvasConnectionVisible(from: CanvasNodeData, to: CanvasNodeData, bounds: CanvasWorldBounds, hitPadding = 30) {
    const connectionBounds = getConnectionPathGeometry(from, to).bounds;
    return connectionBounds.right + hitPadding > bounds.left && connectionBounds.left - hitPadding < bounds.right && connectionBounds.bottom + hitPadding > bounds.top && connectionBounds.top - hitPadding < bounds.bottom;
}

export function getVisibleCanvasConnections(
    connections: CanvasConnection[],
    nodeById: ReadonlyMap<string, CanvasNodeData>,
    bounds: CanvasWorldBounds,
    isHiddenEndpoint?: (node: CanvasNodeData) => boolean,
) {
    return connections.filter((connection) => {
        const from = nodeById.get(connection.fromNodeId);
        const to = nodeById.get(connection.toNodeId);
        if (!from || !to || isHiddenEndpoint?.(from) || isHiddenEndpoint?.(to)) return false;
        return isCanvasConnectionVisible(from, to, bounds);
    });
}
