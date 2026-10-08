/** 读取已创建任务和生成结果时的超时，不能触发重新生成。 */
export class ResultReadTimeoutError extends Error {
  constructor() { super('结果读取超时，请稍后继续读取'); this.name = 'TimeoutError' }
}

export interface ResultRequestOptions {
  timeoutMs?: number
  idleTimeoutMs?: number
}

/** 超时覆盖响应头和响应体；有字节进展的慢速下载可以继续。此函数从不重发请求。 */
export async function fetchResultResponse(url: string, init: RequestInit = {}, options: ResultRequestOptions = {}): Promise<Response> {
  const controller = new AbortController()
  const timeoutMs = Math.max(1, options.timeoutMs ?? 900_000)
  const idleTimeoutMs = Math.max(1, options.idleTimeoutMs ?? 60_000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const expire = () => controller.abort(new ResultReadTimeoutError())
  const totalTimer = setTimeout(expire, timeoutMs)
  const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(expire, idleTimeoutMs) }
  const cancel = () => controller.abort(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
  const interrupted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => {
      // 某些响应体不及时响应 fetch 的取消，需要同时取消读取并结束等待。
      void reader?.cancel().catch(() => undefined)
      reject(controller.signal.reason)
    }, { once: true })
  })
  init.signal?.addEventListener('abort', cancel, { once: true })
  if (init.signal?.aborted) cancel()
  touch()
  try {
    return await Promise.race([interrupted, (async () => {
      controller.signal.throwIfAborted()
      const response = await fetch(url, { ...init, signal: controller.signal })
      controller.signal.throwIfAborted()
      if (!response.body) return response
      reader = response.body.getReader()
      const chunks: ArrayBuffer[] = []
      try {
        for (;;) {
          const { done, value } = await reader.read()
          controller.signal.throwIfAborted()
          if (done) break
          if (value.byteLength) {
            // 明确复制当前字节区间，不能把视图所在的整个共享缓冲区当作响应体。
            const chunk = new Uint8Array(value.byteLength)
            chunk.set(value)
            chunks.push(chunk.buffer)
            touch()
          }
        }
      } finally { reader.releaseLock() }
      return new Response(new Blob(chunks), {
        status: response.status, statusText: response.statusText, headers: response.headers,
      })
    })()])
  } finally {
    clearTimeout(totalTimer)
    clearTimeout(idleTimer)
    init.signal?.removeEventListener('abort', cancel)
  }
}

export function isTransientResultError(error: unknown): boolean {
  return error instanceof ResultReadTimeoutError || error instanceof TypeError
}
