import { memo } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "../types";
import { getConnectionPathGeometry } from "../utils/canvas-viewport";

type ConnectionPathProps = {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    flowReversed: boolean;
    onSelect: (connectionId: string) => void;
};

export const ConnectionPath = memo(function ConnectionPath({ connection, from, to, active, flowReversed, onSelect }: ConnectionPathProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const pathD = getConnectionPathGeometry(from, to, connection).path;

    return (
        <g data-connection-id={connection.id}>
            <path
                d={pathD}
                stroke="transparent"
                strokeWidth="30"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect(connection.id);
                }}
            />
            <path
                d={pathD}
                stroke={active ? theme.node.activeStroke : theme.node.muted}
                strokeWidth={active ? 3 : 2}
                strokeOpacity={active ? 1 : 0.82}
                fill="none"
                style={{ filter: active ? `drop-shadow(0 0 8px ${theme.node.activeStroke}66)` : undefined, pointerEvents: "none" }}
            />
            {/* 只有选中的连线显示流动光带，普通连线保持静态，避免画布整体持续闪动。 */}
            {active ? (
                <path
                    d={pathD}
                    className={`canvas-connection-flow is-active${flowReversed ? " is-reversed" : ""}`}
                    stroke={theme.node.flowStroke}
                    strokeWidth="3.5"
                    strokeOpacity="0.95"
                    strokeDasharray="18 150"
                    strokeLinecap="round"
                    fill="none"
                    style={{ filter: `drop-shadow(0 0 5px ${theme.node.flowStroke}bb)`, pointerEvents: "none" }}
                />
            ) : null}
        </g>
    );
});

export function ActiveConnectionPath({ node, targetNode, handle, mouseWorld }: { node?: CanvasNodeData; targetNode?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const fromSide = handle.handleType === "source" ? "right" : "left";
    const toSide = targetNode
        ? targetNode.type === "config" || mouseWorld.x <= targetNode.position.x + targetNode.width / 2 ? "left" : "right"
        : fromSide === "right" ? "left" : "right";
    // 吸附预览与落点后的曲线共用端点算法，松开鼠标时不再跳到另一侧。
    const target = targetNode ?? { ...node, position: mouseWorld, width: 0, height: 0 };
    const pathD = getConnectionPathGeometry(node, target, { fromSide, toSide }).path;

    return <path data-connection-preview={node.id} d={pathD} stroke={theme.node.activeStroke} strokeWidth="2" fill="none" strokeDasharray="5,5" />;
}
