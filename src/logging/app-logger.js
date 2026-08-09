const fs = require('node:fs');
const path = require('node:path');

const LOG_FILE_NAME = 'agenza.log';
const MAX_LOG_STRING_LENGTH = 1000;
const SENSITIVE_FIELD_PATTERN =
  /^(?:authorization|command|data|env|environment|input|output|password|secret|token|api[_-]?key)$/i;

const redactSecrets = (value) =>
  value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|password|secret|token)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');

const sanitizeString = (value) => {
  const printableValue = [...String(value)]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 32 && (codePoint < 127 || codePoint > 159) ? character : ' ';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  return redactSecrets(printableValue).slice(0, MAX_LOG_STRING_LENGTH);
};

const sanitizeValue = (value, key = '', depth = 0) => {
  if (SENSITIVE_FIELD_PATTERN.test(key)) {
    return '[REDACTED]';
  }

  if (value === undefined) {
    return undefined;
  }

  if (value instanceof Error) {
    return {
      code: value.code === undefined ? undefined : sanitizeString(value.code),
      message: sanitizeString(value.message),
      name: sanitizeString(value.name),
    };
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'bigint') {
    return sanitizeString(value);
  }

  if (depth >= 3) {
    return '[TRUNCATED]';
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, '', depth + 1));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([entryKey, entryValue]) => [
          sanitizeString(entryKey),
          sanitizeValue(entryValue, entryKey, depth + 1),
        ]),
    );
  }

  return sanitizeString(value);
};

const createNoopLogger = () => ({
  error: () => false,
  filePath: null,
  info: () => false,
  warn: () => false,
});

const createAppLogger = ({
  directory,
  fileSystem = fs,
  now = () => new Date(),
  processId = process.pid,
} = {}) => {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new TypeError('The application logger requires a logs directory.');
  }

  const filePath = path.join(directory, LOG_FILE_NAME);

  try {
    fileSystem.mkdirSync(directory, { recursive: true });
  } catch {
    return createNoopLogger();
  }

  const write = (level, event, details = {}) => {
    try {
      const record = {
        timestamp: now().toISOString(),
        level,
        event: sanitizeString(event),
        processId,
        details: sanitizeValue(details),
      };
      fileSystem.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
      return true;
    } catch {
      return false;
    }
  };

  return Object.freeze({
    error: (event, details) => write('error', event, details),
    filePath,
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
  });
};

module.exports = {
  LOG_FILE_NAME,
  MAX_LOG_STRING_LENGTH,
  createAppLogger,
  createNoopLogger,
  sanitizeString,
  sanitizeValue,
};
