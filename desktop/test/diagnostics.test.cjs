const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createTaskDiagnostics } = require('../diagnostics.cjs');

test('任务诊断只写安全字段，限制大小并保留最近一份日志', async () => {
  const directory = await fs.mkdtemp(path.join(process.platform === 'win32' ? 'D:/tmp' : os.tmpdir(), 'desktop-diagnostics-'));
  try {
    const log = createTaskDiagnostics(directory, { maxBytes: 1 });
    log.report({ id: 'first', stage: 'read_body', operation: 'submit', code: 'ERR_UPLOAD_FILE_CHANGED', prompt: 'private-prompt', authorization: 'private-token' });
    log.report({ id: 'second', stage: 'connect_local', operation: 'recover', code: 'ECONNRESET', status: 502 });
    await log.flush();
    const previous = await fs.readFile(path.join(directory, 'task-requests.jsonl.1'), 'utf8');
    const current = await fs.readFile(path.join(directory, 'task-requests.jsonl'), 'utf8');
    assert.equal(JSON.parse(previous).id, 'first');
    assert.equal(JSON.parse(current).id, 'second');
    assert.doesNotMatch(previous + current, /private-/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
