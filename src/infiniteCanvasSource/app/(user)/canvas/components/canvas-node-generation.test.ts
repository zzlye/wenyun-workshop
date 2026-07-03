import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { buildCanvasImageFailureMessage, buildConnectedPromptText, buildNodeGenerationContext, buildNodeGenerationInputs, hasUsableNodeGenerationPrompt, mergeNodeReferenceImages, stripConnectedPromptSuffix } from "./canvas-node-generation";

const baseNode = (node: Partial<CanvasNodeData> & Pick<CanvasNodeData, "id" | "type">): CanvasNodeData => ({
    title: node.id,
    position: { x: 0, y: 0 },
    width: 100,
    height: 100,
    metadata: {},
    ...node,
});

describe("canvas node generation prompt handling", () => {
    it("发送上下文合并上游文字，但节点自身提示词可以单独剥离", () => {
        const textNode = baseNode({
            id: "text-1",
            type: CanvasNodeType.Text,
            metadata: { content: "唐三\n\n小舞" },
        });
        const imageNode = baseNode({
            id: "image-1",
            type: CanvasNodeType.Image,
            metadata: { prompt: "两人站在森林里\n\n唐三\n\n小舞" },
        });
        const connections: CanvasConnection[] = [{ id: "conn-1", fromNodeId: textNode.id, toNodeId: imageNode.id }];

        const inputs = buildNodeGenerationInputs(imageNode.id, [textNode, imageNode], connections);
        const connectedText = buildConnectedPromptText(inputs);

        expect(buildNodeGenerationContext(imageNode.id, [textNode, imageNode], connections, "两人站在森林里").prompt).toBe("两人站在森林里\n\n唐三\n\n小舞");
        expect(stripConnectedPromptSuffix(imageNode.metadata?.prompt || "", connectedText)).toBe("两人站在森林里");
    });

    it("图片节点输入框为空但连着文字节点时依旧可以生成", () => {
        const textNode = baseNode({
            id: "text-1",
            type: CanvasNodeType.Text,
            metadata: { content: "唐三和小舞站在森林里" },
        });
        const imageNode = baseNode({
            id: "image-1",
            type: CanvasNodeType.Image,
            metadata: { prompt: "" },
        });
        const connections: CanvasConnection[] = [{ id: "conn-1", fromNodeId: textNode.id, toNodeId: imageNode.id }];
        const connectedText = buildConnectedPromptText(buildNodeGenerationInputs(imageNode.id, [textNode, imageNode], connections));

        expect(hasUsableNodeGenerationPrompt("", connectedText)).toBe(true);
        expect(buildNodeGenerationContext(imageNode.id, [textNode, imageNode], connections, "").prompt).toBe("唐三和小舞站在森林里");
    });

    it("连接图片节点会作为参考图参与生成", () => {
        const sourceImage = baseNode({
            id: "image-source",
            type: CanvasNodeType.Image,
            title: "角色立绘",
            metadata: { content: "data:image/png;base64,source", storageKey: "image:source", mimeType: "image/png" },
        });
        const targetImage = baseNode({
            id: "image-target",
            type: CanvasNodeType.Image,
            metadata: { prompt: "用 @图1 的角色姿势生成新图" },
        });
        const connections: CanvasConnection[] = [{ id: "conn-image", fromNodeId: sourceImage.id, toNodeId: targetImage.id }];

        const context = buildNodeGenerationContext(targetImage.id, [sourceImage, targetImage], connections, "用 [reference image 1] 的角色姿势生成新图");

        expect(context.imageCount).toBe(1);
        expect(context.referenceImages[0]).toMatchObject({ id: sourceImage.id, dataUrl: sourceImage.metadata?.content, storageKey: "image:source" });
    });

    it("生成节点会递归继承上游图片链路里的参考图", () => {
        const roleImage = baseNode({
            id: "role-image",
            type: CanvasNodeType.Image,
            title: "角色",
            metadata: { content: "data:image/png;base64,role", storageKey: "image:role", mimeType: "image/png" },
        });
        const outfitImage = baseNode({
            id: "outfit-image",
            type: CanvasNodeType.Image,
            title: "服装",
            metadata: { content: "data:image/png;base64,outfit", storageKey: "image:outfit", mimeType: "image/png" },
        });
        const sceneImage = baseNode({
            id: "scene-image",
            type: CanvasNodeType.Image,
            title: "场景",
            metadata: { content: "data:image/png;base64,scene", storageKey: "image:scene", mimeType: "image/png" },
        });
        const targetImage = baseNode({
            id: "target-image",
            type: CanvasNodeType.Image,
            metadata: { prompt: "把角色放进场景里" },
        });
        const connections: CanvasConnection[] = [
            { id: "conn-role-scene", fromNodeId: roleImage.id, toNodeId: sceneImage.id },
            { id: "conn-outfit-scene", fromNodeId: outfitImage.id, toNodeId: sceneImage.id },
            { id: "conn-scene-target", fromNodeId: sceneImage.id, toNodeId: targetImage.id },
        ];

        const context = buildNodeGenerationContext(targetImage.id, [roleImage, outfitImage, sceneImage, targetImage], connections, "把角色放进场景里");

        expect(context.referenceImages.map((image) => image.id)).toEqual(["role-image", "outfit-image", "scene-image"]);
        expect(context.imageCount).toBe(3);
    });

    it("视频节点会递归继承上游音频节点作为参考音频", () => {
        const audioNode = baseNode({
            id: "audio-source",
            type: CanvasNodeType.Audio,
            title: "配乐",
            metadata: { content: "blob:audio-url", storageKey: "audio:source", mimeType: "audio/mpeg" },
        });
        const videoNode = baseNode({
            id: "video-target",
            type: CanvasNodeType.Video,
            metadata: { prompt: "参考 @音频1 的节奏生成视频" },
        });
        const connections: CanvasConnection[] = [{ id: "conn-audio", fromNodeId: audioNode.id, toNodeId: videoNode.id }];

        const context = buildNodeGenerationContext(videoNode.id, [audioNode, videoNode], connections, "参考 [reference audio 1] 的节奏生成视频");

        expect(context.audioCount).toBe(1);
        expect(context.referenceAudios[0]).toMatchObject({ id: audioNode.id, url: audioNode.metadata?.content, storageKey: "audio:source" });
    });

    it("合并参考图时保留手动参考图在连接图之前并按图片去重", () => {
        const manual = { id: "manual-1", name: "手动图", type: "image/png", dataUrl: "data:image/png;base64,manual" };
        const connected = { id: "connected-1", name: "连接图", type: "image/png", dataUrl: "data:image/png;base64,connected" };
        const duplicateConnected = { id: "connected-duplicate", name: "重复连接图", type: "image/png", dataUrl: manual.dataUrl };

        expect(mergeNodeReferenceImages([manual], [connected, duplicateConnected]).map((image) => image.id)).toEqual(["manual-1", "connected-1"]);
    });

    it("批量图片失败时优先显示接口返回的具体错误", () => {
        expect(buildCanvasImageFailureMessage(false, "上游余额不足")).toBe("上游余额不足");
        expect(buildCanvasImageFailureMessage(true, "上游余额不足")).toBe("部分图片生成失败：上游余额不足");
        expect(buildCanvasImageFailureMessage(false, "")).toBe("全部图片生成失败");
    });
});
