const assert = require('node:assert/strict');
const test = require('node:test');

const { LOG_FILE_NAME, createAppLogger, sanitizeString } = require('../src/logging/app-logger');

test('writes structured local diagnostics without terminal content or secrets', () => {
  const directories = [];
  const writes = [];
  const logger = createAppLogger({
    directory: 'C:\\logs',
    fileSystem: {
      appendFileSync: (...parameters) => writes.push(parameters),
      mkdirSync: (...parameters) => directories.push(parameters),
    },
    now: () => new Date('2026-08-09T12:00:00.000Z'),
    processId: 42,
  });

  const wasWritten = logger.error('terminal.start_failed', {
    apiKey: 'sk-secret-value',
    error: Object.assign(new Error('Bearer hidden-token failed'), { code: 'ENOENT' }),
    input: 'do not record this command',
    terminalId: 'terminal-one',
  });
  const record = JSON.parse(writes[0][1]);

  assert.equal(wasWritten, true);
  assert.deepEqual(directories, [['C:\\logs', { recursive: true }]]);
  assert.equal(logger.filePath, `C:\\logs\\${LOG_FILE_NAME}`);
  assert.equal(writes[0][2], 'utf8');
  assert.equal(record.timestamp, '2026-08-09T12:00:00.000Z');
  assert.equal(record.level, 'error');
  assert.equal(record.event, 'terminal.start_failed');
  assert.equal(record.processId, 42);
  assert.equal(record.details.terminalId, 'terminal-one');
  assert.equal(record.details.apiKey, '[REDACTED]');
  assert.equal(record.details.input, '[REDACTED]');
  assert.equal(record.details.error.code, 'ENOENT');
  assert.equal(record.details.error.message, 'Bearer [REDACTED] failed');
  assert.doesNotMatch(writes[0][1], /secret-value|hidden-token|do not record/);

  logger.warn('terminal.exited', { signal: undefined, terminalId: 'terminal-one' });
  const exitRecord = JSON.parse(writes[1][1]);
  assert.equal('signal' in exitRecord.details, false);
});

test('sanitizes control characters and tolerates unavailable log storage', () => {
  assert.equal(sanitizeString('line one\r\nline two\x1b[31m'), 'line one line two [31m');

  const logger = createAppLogger({
    directory: 'C:\\unavailable',
    fileSystem: {
      mkdirSync: () => {
        throw new Error('denied');
      },
    },
  });

  assert.equal(logger.filePath, null);
  assert.equal(logger.info('app.ready'), false);
  assert.equal(logger.warn('terminal.exited'), false);
});
