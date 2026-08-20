const crypto = require('node:crypto');

const EVENT_PATTERN = /^git\.[a-z0-9_.]{1,100}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,79}$/;
const ALLOWED_LEVELS = new Set(['error', 'info', 'warn']);
const ALLOWED_OPERATION_TYPES = new Set([
  'attach',
  'cleanup',
  'create_existing',
  'create_new',
  'preview',
  'status',
]);
const ALLOWED_OWNERSHIP_KINDS = new Set(['agenza', 'external']);
const ALLOWED_ROLLBACK_STATES = new Set(['manual-recovery', 'not-required', 'rolled-back']);
const ALLOWED_WORKSPACE_STATES = new Set([
  'available',
  'blocked',
  'clean',
  'conflicted',
  'dirty',
  'discovered',
  'failed',
  'previewed',
  'stale',
  'succeeded',
  'unassigned',
]);

const fingerprintIdentifier = (kind, value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    return undefined;
  }

  const digest = crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
  return `${kind}:${digest}`;
};

const sanitizeGitLifecycleDetails = (details = {}) => {
  const safe = {};
  const terminal = fingerprintIdentifier('terminal', details.terminalId);
  const operation = fingerprintIdentifier('operation', details.operationId);
  const creation = fingerprintIdentifier('worktree', details.creationId);

  if (terminal) {
    safe.terminal = terminal;
  }
  if (operation) {
    safe.operation = operation;
  }
  if (creation) {
    safe.worktree = creation;
  }
  if (typeof details.errorCode === 'string' && ERROR_CODE_PATTERN.test(details.errorCode)) {
    safe.errorCode = details.errorCode;
  }
  if (ALLOWED_OPERATION_TYPES.has(details.operationType)) {
    safe.operationType = details.operationType;
  }
  if (ALLOWED_OWNERSHIP_KINDS.has(details.ownershipKind)) {
    safe.ownershipKind = details.ownershipKind;
  }
  if (ALLOWED_ROLLBACK_STATES.has(details.rollbackState)) {
    safe.rollbackState = details.rollbackState;
  }
  if (ALLOWED_WORKSPACE_STATES.has(details.workspaceState)) {
    safe.workspaceState = details.workspaceState;
  }

  return Object.freeze(safe);
};

const writeGitLifecycleLog = (logger, level, event, details) => {
  if (!ALLOWED_LEVELS.has(level) || !EVENT_PATTERN.test(event)) {
    return false;
  }

  try {
    return logger?.[level]?.(event, sanitizeGitLifecycleDetails(details)) ?? false;
  } catch {
    return false;
  }
};

module.exports = {
  fingerprintIdentifier,
  sanitizeGitLifecycleDetails,
  writeGitLifecycleLog,
};
