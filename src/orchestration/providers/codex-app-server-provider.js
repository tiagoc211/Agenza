const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const readline = require('node:readline');

const { killProcessTree } = require('../../terminal/process-tree');
const { MAX_RESULT_LENGTH } = require('../orchestration-model');

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const MAX_JSON_RPC_LINE_LENGTH = 8 * 1024 * 1024;

const createCodexAppServerProcess = ({ environment = process.env, spawnProcess = spawn } = {}) => {
  const command =
    Object.entries(environment).find(([key]) => key.toLowerCase() === 'comspec')?.[1] ??
    (process.platform === 'win32' ? 'cmd.exe' : environment.SHELL || '/bin/sh');
  const args =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'codex app-server --stdio']
      : ['-lc', 'exec codex app-server --stdio'];

  return spawnProcess(command, args, {
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
};

const copyRuntime = (runtime) => ({
  agentId: runtime.agentId,
  status: runtime.status,
  threadId: runtime.threadId,
  turnId: runtime.turnId,
  cwd: runtime.cwd,
  model: runtime.model,
  result: runtime.result,
  error: runtime.error,
});

class CodexAppServerProvider {
  constructor({
    createProcess = createCodexAppServerProcess,
    processTreeKiller = killProcessTree,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = {}) {
    if (
      typeof createProcess !== 'function' ||
      typeof processTreeKiller !== 'function' ||
      !Number.isInteger(requestTimeoutMs) ||
      requestTimeoutMs < 1
    ) {
      throw new TypeError('Codex App Server provider requires process and timeout controls.');
    }
    this._createProcess = createProcess;
    this._processTreeKiller = processTreeKiller;
    this._requestTimeoutMs = requestTimeoutMs;
    this._process = null;
    this._lineReader = null;
    this._initializing = null;
    this._nextRequestId = 1;
    this._pending = new Map();
    this._runtimes = new Map();
    this._threadAgents = new Map();
    this._completionWaiters = new Map();
    this._events = new EventEmitter();
    this._disposed = false;
  }

  async start({
    agentId,
    cwd,
    instruction,
    model = null,
    outputSchema = null,
    readOnly = false,
  } = {}) {
    if (
      typeof agentId !== 'string' ||
      !agentId ||
      typeof cwd !== 'string' ||
      !cwd ||
      typeof instruction !== 'string' ||
      !instruction
    ) {
      throw new TypeError('Codex provider start requires an agent, cwd, and instruction.');
    }
    if (this._runtimes.has(agentId)) {
      throw new Error(`Codex agent "${agentId}" already has a runtime.`);
    }

    await this._ensureInitialized();
    const threadParams = {
      approvalPolicy: 'never',
      cwd,
      sandbox: readOnly ? 'readOnly' : 'workspaceWrite',
      serviceName: 'agenza',
      ...(model ? { model } : {}),
    };
    const threadResponse = await this._request('thread/start', threadParams);
    const threadId = threadResponse?.thread?.id;
    if (typeof threadId !== 'string' || !threadId) {
      throw new Error('Codex App Server returned an invalid thread.');
    }

    const runtime = {
      agentId,
      cwd,
      error: null,
      lastMessage: '',
      model,
      result: null,
      status: 'starting',
      threadId,
      turnId: null,
    };
    this._runtimes.set(agentId, runtime);
    this._threadAgents.set(threadId, agentId);

    try {
      const turnResponse = await this._request('turn/start', {
        approvalPolicy: 'never',
        cwd,
        input: [{ type: 'text', text: instruction }],
        sandboxPolicy: readOnly
          ? { type: 'readOnly', access: { type: 'fullAccess' } }
          : {
              type: 'workspaceWrite',
              writableRoots: [cwd],
              readOnlyAccess: { type: 'fullAccess' },
              networkAccess: false,
            },
        threadId,
        ...(model ? { model } : {}),
        ...(outputSchema ? { outputSchema } : {}),
      });
      runtime.turnId = turnResponse?.turn?.id ?? runtime.turnId;
      if (!['completed', 'failed', 'stopped'].includes(runtime.status)) {
        runtime.status = 'working';
        this._emit({ type: 'started', runtime });
      }
      return copyRuntime(runtime);
    } catch (error) {
      runtime.status = 'failed';
      runtime.error = error.message;
      this._settleCompletion(runtime);
      this._emit({ type: 'failed', runtime });
      throw error;
    }
  }

  async sendInstruction(agentId, instruction) {
    const runtime = this._requireRuntime(agentId);
    if (typeof instruction !== 'string' || !instruction) {
      throw new TypeError('Agent instruction must be a non-empty string.');
    }
    if (['starting', 'working', 'waiting'].includes(runtime.status) && runtime.turnId) {
      await this._request('turn/steer', {
        expectedTurnId: runtime.turnId,
        input: [{ type: 'text', text: instruction }],
        threadId: runtime.threadId,
      });
      return copyRuntime(runtime);
    }
    const turnResponse = await this._request('turn/start', {
      approvalPolicy: 'never',
      cwd: runtime.cwd,
      input: [{ type: 'text', text: instruction }],
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [runtime.cwd],
        readOnlyAccess: { type: 'fullAccess' },
        networkAccess: false,
      },
      threadId: runtime.threadId,
      ...(runtime.model ? { model: runtime.model } : {}),
    });
    runtime.turnId = turnResponse?.turn?.id ?? null;
    runtime.status = 'working';
    runtime.result = null;
    runtime.error = null;
    runtime.lastMessage = '';
    this._emit({ type: 'working', runtime });
    return copyRuntime(runtime);
  }

  async stop(agentId) {
    const runtime = this._requireRuntime(agentId);
    if (['completed', 'failed', 'stopped'].includes(runtime.status)) {
      return copyRuntime(runtime);
    }
    if (runtime.turnId) {
      try {
        await this._request('turn/interrupt', {
          threadId: runtime.threadId,
          turnId: runtime.turnId,
        });
      } catch {
        // The process cleanup path remains authoritative if the turn no longer exists.
      }
    }
    runtime.status = 'stopped';
    this._settleCompletion(runtime);
    this._emit({ type: 'stopped', runtime });
    return copyRuntime(runtime);
  }

  getStatus(agentId) {
    return copyRuntime(this._requireRuntime(agentId));
  }

  onEvent(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Provider event subscription requires a callback.');
    }
    this._events.on('event', listener);
    return () => this._events.off('event', listener);
  }

  waitForCompletion(agentId) {
    const runtime = this._requireRuntime(agentId);
    if (['completed', 'failed', 'stopped'].includes(runtime.status)) {
      return Promise.resolve(copyRuntime(runtime));
    }
    return new Promise((resolve) => {
      const waiters = this._completionWaiters.get(agentId) ?? new Set();
      waiters.add(resolve);
      this._completionWaiters.set(agentId, waiters);
    });
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    const error = new Error('Codex App Server provider was disposed.');
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this._pending.clear();
    for (const runtime of this._runtimes.values()) {
      if (!['completed', 'failed', 'stopped'].includes(runtime.status)) {
        runtime.status = 'stopped';
        this._settleCompletion(runtime);
        this._emit({ type: 'stopped', runtime });
      }
    }
    this._lineReader?.close();
    this._lineReader = null;
    if (this._process) {
      const child = this._process;
      this._process = null;
      if (Number.isInteger(child.pid) && child.pid > 0) {
        const killed = this._processTreeKiller(child.pid);
        if (!killed) child.kill();
      } else {
        child.kill();
      }
    }
    this._events.removeAllListeners();
  }

  async _ensureInitialized() {
    if (this._disposed) throw new Error('Codex App Server provider is disposed.');
    if (this._initializing) return this._initializing;
    this._initializing = this._startProcess();
    try {
      await this._initializing;
    } catch (error) {
      this._initializing = null;
      throw error;
    }
  }

  async _startProcess() {
    const child = this._createProcess();
    if (!child?.stdin || !child?.stdout || typeof child.on !== 'function') {
      throw new Error('Codex App Server could not create a structured stdio process.');
    }
    this._process = child;
    this._lineReader = readline.createInterface({ input: child.stdout });
    this._lineReader.on('line', (line) => this._handleLine(line));
    child.stderr?.on?.('data', () => undefined);
    child.on('error', (error) => this._handleProcessFailure(error));
    child.on('exit', (code, signal) => {
      if (this._process === child) {
        this._process = null;
        this._handleProcessFailure(
          new Error(
            `Codex App Server exited before disposal (${code ?? 'unknown'}/${signal ?? 0}).`,
          ),
        );
      }
    });
    await this._request('initialize', {
      clientInfo: { name: 'agenza', title: 'Agenza', version: '0.3.0' },
    });
    this._notify('initialized', {});
  }

  _request(method, params) {
    if (!this._process?.stdin?.writable) {
      return Promise.reject(new Error('Codex App Server is not available.'));
    }
    const id = this._nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Codex App Server request "${method}" timed out.`));
      }, this._requestTimeoutMs);
      this._pending.set(id, { reject, resolve, timeout });
      try {
        this._write({ id, method, params });
      } catch (error) {
        clearTimeout(timeout);
        this._pending.delete(id);
        reject(error);
      }
    });
  }

  _notify(method, params) {
    this._write({ method, params });
  }

  _write(message) {
    if (!this._process?.stdin?.writable) {
      throw new Error('Codex App Server input is closed.');
    }
    this._process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _handleLine(line) {
    if (typeof line !== 'string' || line.length > MAX_JSON_RPC_LINE_LENGTH) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (Object.hasOwn(message, 'id') && !message.method) {
      const pending = this._pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this._pending.delete(message.id);
      if (message.error)
        pending.reject(new Error(message.error.message || 'Codex request failed.'));
      else pending.resolve(message.result);
      return;
    }
    if (Object.hasOwn(message, 'id') && message.method) {
      this._handleServerRequest(message);
      return;
    }
    if (typeof message.method === 'string') {
      this._handleNotification(message.method, message.params ?? {});
    }
  }

  _handleServerRequest(message) {
    const runtime = this._runtimeForParams(message.params);
    if (runtime) {
      runtime.status = 'waiting';
      this._emit({ type: 'waiting', runtime });
    }
    let result = { decision: 'decline' };
    if (message.method === 'item/permissions/requestApproval') {
      result = { permissions: [], scope: 'turn' };
    } else if (message.method === 'mcpServer/elicitation/request') {
      result = { action: 'decline', content: null };
    }
    this._write({ id: message.id, result });
  }

  _handleNotification(method, params) {
    const runtime = this._runtimeForParams(params);
    if (!runtime) return;

    if (method === 'turn/started') {
      runtime.turnId = params.turn?.id ?? runtime.turnId;
      runtime.status = 'working';
      this._emit({ type: 'working', runtime });
      return;
    }
    if (method === 'serverRequest/resolved' && runtime.status === 'waiting') {
      runtime.status = 'working';
      this._emit({ type: 'working', runtime });
      return;
    }
    if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      runtime.lastMessage = String(params.item.text ?? '').slice(0, MAX_RESULT_LENGTH);
      return;
    }
    if (method !== 'turn/completed') return;

    const turnStatus = params.turn?.status;
    runtime.turnId = params.turn?.id ?? runtime.turnId;
    if (turnStatus === 'completed') {
      runtime.status = 'completed';
      runtime.result = runtime.lastMessage;
      this._settleCompletion(runtime);
      this._emit({ type: 'completed', runtime });
    } else if (turnStatus === 'interrupted') {
      runtime.status = 'stopped';
      this._settleCompletion(runtime);
      this._emit({ type: 'stopped', runtime });
    } else {
      runtime.status = 'failed';
      runtime.error = String(params.turn?.error?.message ?? 'Codex turn failed.').slice(
        0,
        MAX_RESULT_LENGTH,
      );
      this._settleCompletion(runtime);
      this._emit({ type: 'failed', runtime });
    }
  }

  _runtimeForParams(params) {
    const threadId = params?.threadId ?? params?.turn?.threadId ?? params?.thread?.id;
    const agentId = this._threadAgents.get(threadId);
    return agentId ? (this._runtimes.get(agentId) ?? null) : null;
  }

  _handleProcessFailure(error) {
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this._pending.clear();
    for (const runtime of this._runtimes.values()) {
      if (!['completed', 'failed', 'stopped'].includes(runtime.status)) {
        runtime.status = 'failed';
        runtime.error = 'Codex App Server stopped unexpectedly.';
        this._settleCompletion(runtime);
        this._emit({ type: 'failed', runtime });
      }
    }
  }

  _settleCompletion(runtime) {
    for (const resolve of this._completionWaiters.get(runtime.agentId) ?? []) {
      resolve(copyRuntime(runtime));
    }
    this._completionWaiters.delete(runtime.agentId);
  }

  _emit({ type, runtime }) {
    this._events.emit('event', Object.freeze({ type, runtime: copyRuntime(runtime) }));
  }

  _requireRuntime(agentId) {
    const runtime = this._runtimes.get(agentId);
    if (!runtime) throw new Error(`Unknown Codex agent runtime "${agentId}".`);
    return runtime;
  }
}

module.exports = {
  CodexAppServerProvider,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_JSON_RPC_LINE_LENGTH,
  createCodexAppServerProcess,
};
