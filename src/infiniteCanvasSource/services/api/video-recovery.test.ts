import axios from "axios";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultConfig } from "../../stores/use-config-store";
import { requestVideoGeneration, VideoTaskPendingError } from "./video";

vi.mock("axios", () => ({ default: { post: vi.fn(), get: vi.fn(), isAxiosError: (e: { isAxiosError?: boolean }) => Boolean(e?.isAxiosError) } }));
const config = { ...defaultConfig, videoApiKey: "video-key" };
const blob = new Blob(["video"], { type: "video/mp4" });
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("状态查询卡住后及时重查原任务，不等待整个生成窗口", async () => {
    vi.mocked(axios.get).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
        setTimeout(() => reject({ isAxiosError: true, code: "ECONNABORTED" }), options?.timeout);
    })).mockResolvedValueOnce({ data: { id: "saved", status: "completed" } })
        .mockResolvedValueOnce({ data: blob });
    let completed = false;
    const request = requestVideoGeneration(config, "", [], [], [], { taskId: "saved" }).then(result => { completed = true; return result; });
    await vi.advanceTimersByTimeAsync(31000);
    expect(completed).toBe(true);
    expect(await request).toBe(blob);
    expect(axios.post).not.toHaveBeenCalled();
});

it("已完成后台任务下载无进展时取消卡住请求并走同源备用路径", async () => {
    let cancelled = false;
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { id: "async_saved", status: "succeeded", media: [{ kind: "video", url: "/v1/tasks/async_saved/media/0" }] } })
        .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
            options?.signal?.addEventListener?.("abort", () => { cancelled = true; reject({ isAxiosError: true, code: "ERR_CANCELED" }); });
        })).mockResolvedValueOnce({ data: blob });
    let completed = false;
    const request = requestVideoGeneration(config, "", [], [], [], { taskId: "async_saved" }).then(result => { completed = true; return result; });
    await vi.advanceTimersByTimeAsync(61000);
    expect(cancelled).toBe(true);
    expect(completed).toBe(true);
    expect(await request).toBe(blob);
    expect(axios.get).toHaveBeenLastCalledWith("/newapi-proxy/wenyun/v1/tasks/async_saved/media/0", expect.objectContaining({ headers: { Authorization: "Bearer video-key" } }));
    expect(axios.post).not.toHaveBeenCalled();
});

it("下载持续有字节进展时允许超过一分钟，不误中断慢速视频", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { id: "saved", status: "completed" } })
        .mockImplementationOnce((_url, options) => new Promise((resolve, reject) => {
            options?.signal?.addEventListener?.("abort", () => reject(new Error("不应中断有进度的下载")));
            setTimeout(() => options?.onDownloadProgress?.({ loaded: 100 } as never), 45000);
            setTimeout(() => resolve({ data: blob }), 90000);
        }));
    const request = requestVideoGeneration(config, "", [], [], [], { taskId: "saved" });
    await vi.advanceTimersByTimeAsync(91000);
    expect(await request).toBe(blob);
    expect(axios.get).toHaveBeenCalledTimes(2);
});

it("临近轮询等待结束才完成的任务仍有独立的下载时间", async () => {
    vi.mocked(axios.get).mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 1800000);
        return { data: { id: "saved", status: "completed" } };
    }).mockResolvedValueOnce({ data: blob });
    const request = requestVideoGeneration(config, "", [], [], [], { taskId: "saved" });
    await vi.advanceTimersByTimeAsync(10);
    expect(await request).toBe(blob);
    const options = vi.mocked(axios.get).mock.calls.at(-1)?.[1];
    expect(options?.timeout).toBeGreaterThan(0);
});

it("下载全部失败保留原任务编号，恢复时只查询不重新生成", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { id: "async_saved", status: "succeeded", media: [{ kind: "video", url: "/v1/tasks/async_saved/media/0" }] } })
        .mockRejectedValue({ isAxiosError: true, response: { status: 503 } });
    const request = requestVideoGeneration(config, "", [], [], [], { taskId: "async_saved" }).catch(error => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await request).toBeInstanceOf(VideoTaskPendingError);
    expect((await request).taskId).toBe("async_saved");
    expect(axios.post).not.toHaveBeenCalled();
});

it("结果地址的回退下载中途停滞时仍退出等待并保留原任务", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { id: "saved", status: "completed", video_url: "https://cdn.example/video.mp4" } })
        .mockRejectedValue({ isAxiosError: true, response: { status: 503 } });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array([1]));
            init?.signal?.addEventListener("abort", () => controller.error(new Error("连接已取消")));
        },
    }), { headers: { "Content-Type": "video/mp4" } }));
    let pending: unknown;
    const request = requestVideoGeneration(config, "", [], [], [], { taskId: "saved" }).catch(error => { pending = error; });
    await vi.advanceTimersByTimeAsync(61000);
    expect(pending).toBeInstanceOf(VideoTaskPendingError);
    await request;
    expect(axios.post).not.toHaveBeenCalled();
});
