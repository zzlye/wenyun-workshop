import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/** 先原子保存受理凭据再开始轮询，重启后只能续查，不重放生成请求。 */
export function createTaskJournal(directory, { encode = value => value, decode = value => value } = {}) {
  if (!directory) return null
  const root = path.resolve(directory)
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const file = (id, suffix) => {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('任务存储编号无效')
    return path.join(root, `${id}.${suffix}`)
  }
  async function atomic(target, bytes) {
    await fsp.writeFile(`${target}.tmp`, bytes, { mode: 0o600 })
    await fsp.rename(`${target}.tmp`, target)
  }
  return {
    load() {
      return fs.readdirSync(root).filter(name => /^[a-zA-Z0-9-]+\.json$/.test(name)).map(name => {
        // 无法解密或损坏的日志必须让启动失败，不能忽略后失去防重保护。
        const task = JSON.parse(decode(fs.readFileSync(path.join(root, name))).toString())
        file(task.id, 'json')
        task.headers = task.headers ? new Headers(task.headers) : null
        return task
      })
    },
    async save(task) {
      if (task.responseBody) {
        await atomic(file(task.id, 'body'), task.responseBody)
        task.resultStored = true
      }
      const { requestBody, responseBody, ...record } = task
      record.headers = task.headers ? Array.from(task.headers.entries()) : null
      await atomic(file(task.id, 'json'), encode(Buffer.from(JSON.stringify(record))))
      // 大结果保存到文件，不在常驻进程中堆积所有用户的 Base64。
      if (task.resultStored) task.responseBody = null
    },
    read(task) { return fsp.readFile(file(task.id, 'body')) },
    remove(task) {
      for (const suffix of ['json', 'body']) fs.rmSync(file(task.id, suffix), { force: true })
    },
  }
}
