import axios from "axios";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { defaultConfig } from "../../stores/use-config-store";
import { requestVideoGeneration } from "./video";

vi.mock("axios", () => ({ default: { post: vi.fn(), get: vi.fn(), isAxiosError: (error: { isAxiosError?: boolean }) => Boolean(error?.isAxiosError) } }));

const config = { ...defaultConfig, videoApiKey: "test-key", videoModel: "wan-3.0", videoSeconds: "30", vquality: "720", size: "16:9" };
const image = { id: "image", name: "主图", type: "image/png", url: "https://cdn.example/image.png", dataUrl: "" };
const audio = (id: string) => ({ id, name: id, type: "audio/mpeg", url: `https://cdn.example/${id}.mp3`, duration: 20 });
const video = (id: string) => ({ id, name: id, type: "video/mp4", url: `https://cdn.example/${id}.mp4` });
const models = ["wan-3.0", "seedance-2.0-720p", "seedance-2.5-720p", "sd-2.5-720p", "kling-3.0-omni-1080p", "new-api-video"];

beforeEach(() => {
    vi.resetAllMocks();
    (axios.post as Mock).mockResolvedValue({ data: { id: "task-contract", status: "completed" } });
    (axios.get as Mock).mockResolvedValue({ data: new Blob(["video"], { type: "video/mp4" }) });
});

describe("统一视频请求协议", () => {
    it("后台任务先返回编号，暂时查询失败后继续查询并下载已保存视频", async () => {
        const onCreated = vi.fn();
        (axios.post as Mock).mockResolvedValueOnce({ data: { id: "async_saved", status: "pending", poll_url: "/v1/tasks/async_saved" } });
        (axios.get as Mock).mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
            .mockResolvedValueOnce({ data: { id: "async_saved", status: "succeeded", media: [{ kind: "video", url: "/v1/tasks/async_saved/media/0" }] } })
            .mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        await requestVideoGeneration(config, "后台生成", [], [], [], undefined, onCreated);
        expect(onCreated).toHaveBeenCalledWith({ taskId: "async_saved" });
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(axios.get).toHaveBeenNthCalledWith(1, "/api-proxy/wenyun/tasks/async_saved", expect.any(Object));
        expect(axios.get).toHaveBeenLastCalledWith("/api-proxy/wenyun/tasks/async_saved/media/0", expect.objectContaining({ responseType: "blob" }));
    });

    it("后台任务过期时明确报错且不重新生成", async () => {
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "async_expired", status: "succeeded", result_expired: true } });
        await expect(requestVideoGeneration(config, "", [], [], [], { taskId: "async_expired" })).rejects.toThrow("视频文件已过期");
        expect(axios.post).not.toHaveBeenCalled();
    });
    it.each(models.flatMap((model) => ["480", "720", "1080"].map((resolution) => [model, resolution])))("%s 提交所选 %sp 与完整参考数组，不携带旧字段", async (model, resolution) => {
        await requestVideoGeneration({ ...config, videoModel: model, vquality: resolution }, "镜头向前移动", [image], [audio("a1"), audio("a2")], [video("v1"), video("v2")]);
        expect((axios.post as Mock).mock.calls[0][1]).toEqual({
            model, prompt: "镜头向前移动", duration: 30, resolution: `${resolution}p`, aspect_ratio: "16:9",
            generate_audio: true,
            image_urls: [image.url], audio_urls: [audio("a1").url, audio("a2").url], video_urls: [video("v1").url, video("v2").url],
        });
        expect(axios.get).toHaveBeenCalledWith("/api-proxy/wenyun/videos/task-contract/content", expect.any(Object));
    });

    it.each(models)("%s 允许独立音频参考，不继承旧模型时长和配图限制", async (model) => {
        await requestVideoGeneration({ ...config, videoModel: model }, "按照音乐生成", [], [audio("solo")]);
        const payload = (axios.post as Mock).mock.calls[0][1];
        expect(payload.audio_urls).toEqual([audio("solo").url]);
        expect(payload).not.toHaveProperty("image_urls");
        expect(payload).not.toHaveProperty("video_urls");
    });

    it("动态模型名和所选清晰度原样提交", async () => {
        await requestVideoGeneration({ ...config, videoModel: "new-api-video", vquality: "1080", videoSeconds: "23" }, "测试", [], [], [video("first"), video("second")]);
        expect((axios.post as Mock).mock.calls[0][1]).toMatchObject({ model: "new-api-video", duration: 23, resolution: "1080p", video_urls: [video("first").url, video("second").url] });
    });

    it("Kling 单图同样使用 image_urls，不再强制发送供应商私有字段", async () => {
        await requestVideoGeneration({ ...config, videoModel: "kling-3.0-omni-1080p", videoSeconds: "10" }, "测试", [image]);
        expect((axios.post as Mock).mock.calls[0][1]).toEqual({ model: "kling-3.0-omni-1080p", prompt: "测试", duration: 10, resolution: "720p", aspect_ratio: "16:9", image_urls: [image.url], generate_audio: true });
    });

    it("失效的本地预览地址明确报错，不静默丢弃参考视频后创建付费任务", async () => {
        await expect(requestVideoGeneration(config, "测试", [], [], [{ ...video("local"), url: "blob:http://localhost/preview" }])).rejects.toThrow("参考视频读取失败");
        expect(axios.post).not.toHaveBeenCalled();
    });

    it("本地视频内容通过统一数组提交，不把 blob 地址传给渠道", async () => {
        await requestVideoGeneration(config, "参考视频", [], [], [{ ...video("local"), url: "data:video/mp4;base64,dmlkZW8=" }]);
        expect((axios.post as Mock).mock.calls[0][1].video_urls).toEqual(["data:video/mp4;base64,dmlkZW8="]);
    });

    it("恢复任务即使提示词和原素材已移除也只查询已有编号", async () => {
        (axios.get as Mock).mockResolvedValueOnce({ data: { id: "saved", status: "completed" } }).mockResolvedValueOnce({ data: new Blob(["video"], { type: "video/mp4" }) });
        await requestVideoGeneration(config, "", [], [], [{ ...video("missing"), url: "blob:missing" }], { taskId: "saved" });
        expect(axios.post).not.toHaveBeenCalled();
        expect(axios.get).toHaveBeenCalledWith("/api-proxy/wenyun/videos/saved", expect.any(Object));
    });

    it("已配置渠道返回字段错误时不重复提交并解开嵌套错误文本", async () => {
        (axios.post as Mock).mockRejectedValueOnce({ isAxiosError: true, response: { status: 400, headers: { "x-new-api-video-protocol": "configured" }, data: { message: JSON.stringify({ error: { message: "input_reference must be an object containing image_url" } }) } } });
        await expect(requestVideoGeneration(config, "测试", [image])).rejects.toThrow(/^input_reference must be an object containing image_url$/);
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it("无参考素材时省略三个可选数组", async () => {
        await requestVideoGeneration(config, "测试");
        expect((axios.post as Mock).mock.calls[0][1]).toEqual({ model: config.videoModel, prompt: "测试", duration: 30, resolution: "720p", aspect_ratio: "16:9", generate_audio: true });
    });

    it("本地音频保留数组形式，不套用原先的音频时长限制", async () => {
        await requestVideoGeneration({ ...config, videoModel: "seedance-2.0-720p" }, "测试", [], [{ ...audio("local"), url: "data:audio/wav;base64,YXVkaW8=" }]);
        expect((axios.post as Mock).mock.calls[0][1].audio_urls).toEqual(["data:audio/wav;base64,YXVkaW8="]);
    });

    it.each([true, false])("生成音频开关 %s 以布尔值发送，不受参考音频影响", async (enabled) => {
        await requestVideoGeneration({ ...config, videoGenerateAudio: enabled }, "测试", [], [audio("solo")]);
        expect((axios.post as Mock).mock.calls[0][1]).toMatchObject({ generate_audio: enabled, audio_urls: [audio("solo").url] });
    });

    it.each([
        { error: { message: "seconds is required" } },
        { message: "Missing required parameter: seconds" },
        { message: "缺少参数 seconds" },
        { error: { param: "seconds", code: "missing_required_parameter" } },
        { detail: [{ loc: ["body", "seconds"], type: "missing", msg: "Field required" }] },
    ])("任意模型遇到明确缺 seconds 错误后转换一次：%j", async (data) => {
        (axios.post as Mock).mockRejectedValueOnce({ isAxiosError: true, response: { status: 422, data } });
        await requestVideoGeneration({ ...config, videoModel: "arbitrary-future-model", videoGenerateAudio: false }, "测试", [image]);
        expect(axios.post).toHaveBeenCalledTimes(2);
        const [first, second] = (axios.post as Mock).mock.calls.map((call) => call[1]);
        expect(first.duration).toBe(30);
        const { duration, ...rest } = first;
        expect(second).toEqual({ ...rest, seconds: duration });
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it.each([
        { status: 500, data: { error: { message: "seconds is required" } } },
        { status: 401, data: { error: { message: "seconds is required" } } },
        { status: 429, data: { error: { message: "seconds is required" } } },
        { status: 400, data: { error: { message: "seconds must be less than 15" } } },
        { status: 400, data: { error: { message: "prompt is required" } } },
        { status: 400, data: { id: "created-task", error: { message: "seconds is required" } } },
        { status: 400, data: { data: { task_id: "created-task" }, error: { message: "seconds is required" } } },
        { status: 422, data: { detail: [{ loc: ["body", "audio", "seconds"], type: "missing" }] } },
    ])("已创建任务或非缺字段错误不重复提交：%j", async (response) => {
        (axios.post as Mock).mockRejectedValueOnce({ isAxiosError: true, response });
        await expect(requestVideoGeneration(config, "测试")).rejects.toThrow();
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it("网络超时不重复创建任务", async () => {
        (axios.post as Mock).mockRejectedValueOnce({ isAxiosError: true, code: "ECONNABORTED" });
        await expect(requestVideoGeneration(config, "测试")).rejects.toThrow();
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it("转换失败直接显示错误，不在字段之间反复重试", async () => {
        (axios.post as Mock)
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 400, data: { error: { message: "seconds is required" } } } })
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 400, data: { error: { message: "duration is required" } } } });
        await expect(requestVideoGeneration(config, "测试")).rejects.toThrow("duration is required");
        expect(axios.post).toHaveBeenCalledTimes(2);
    });
});
