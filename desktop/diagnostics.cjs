const fs = require('node:fs/promises');
const path = require('node:path');

/** 只保存本机任务失败的阶段与错误码，不记录请求正文、链接、Cookie 或密钥。 */
function createTaskDiagnostics(directory, { maxBytes = 1024 * 1024 } = {}) {
  const file = path.join(directory, 'task-requests.jsonl');
  let pending = Promise.resolve();
  const report = (event) => {
    const clean = {
      time: new Date().toISOString(),
      id: /^[a-z0-9-]{1,64}$/i.test(event.id || '') ? event.id : undefined,
      operation: ['submit', 'recover', 'read'].includes(event.operation) ? event.operation : 'read',
      stage: ['read_body', 'connect_local', 'response'].includes(event.stage) ? event.stage : 'response',
      code: /^[A-Z][A-Z0-9_]{0,63}$/.test(event.code || '') ? event.code : 'UNKNOWN',
      status: Number.isInteger(event.status) ? event.status : undefined,
    };
    pending = pending.then(async () => {
      await fs.mkdir(directory, { recursive: true });
      const size = await fs.stat(file).then(info => info.size, () => 0);
      if (size >= maxBytes) {
        await fs.rm(`${file}.1`, { force: true });
        await fs.rename(file, `${file}.1`);
      }
      await fs.appendFile(file, `${JSON.stringify(clean)}\n`, { mode: 0o600 });
    }).catch(() => { /* 诊断写入失败不能影响任务提交或覆盖原始错误。 */ });
  };
  return { report, flush: () => pending };
}

module.exports = { createTaskDiagnostics };
