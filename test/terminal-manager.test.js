const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TERMINAL_SESSION_ID_PATTERN,
  TerminalManager,
  createTerminalSessionId,
} = require('../src/terminal/terminal-manager');
const { TerminalSession } = require('../src/terminal/terminal-session');

class FakeSession {
  constructor(id, pid) {
    this.id = id;
    this.pid = pid;
    this.isRunning = false;
    this.columns = 80;
    this.rows = 24;
    this.writes = [];
    this.startOptions = [];
    this.disposeCount = 0;
    this.killCount = 0;
    this.dataListeners = new Set();
    this.exitListeners = new Set();
  }

  start(options) {
    this.isRunning = true;
    this.startOptions.push(options);
    this.columns = options.columns ?? 80;
    this.rows = options.rows ?? 24;
    return this.snapshot();
  }

  write(data) {
    this.writes.push(data);
  }

  resize(columns, rows) {
    this.columns = columns;
    this.rows = rows;
  }

  clear() {}

  kill() {
    this.killCount += 1;

    if (!this.isRunning) {
      return false;
    }

    this.isRunning = false;
    for (const listener of this.exitListeners) {
      listener({ exitCode: 0, signal: 0 });
    }
    return true;
  }

  onData(listener) {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onExit(listener) {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  emitData(data) {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  snapshot() {
    return {
      id: this.id,
      isRunning: this.isRunning,
      pid: this.isRunning ? this.pid : null,
      columns: this.columns,
      rows: this.rows,
    };
  }

  dispose() {
    this.disposeCount += 1;
    this.kill();
  }
}

const createManagerHarness = () => {
  const sessions = new Map();
  let nextPid = 1000;
  let nextId = 1;
  const manager = new TerminalManager({
    sessionDefaults: { shell: 'shell.exe' },
    sessionFactory: (id) => {
      const session = new FakeSession(id, nextPid++);
      sessions.set(id, session);
      return session;
    },
    sessionIdFactory: () =>
      `terminal-00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
  });

  return { manager, sessions };
};

test('generates stable UUID terminal ids and starts with an empty dynamic registry', () => {
  const manager = new TerminalManager();
  const generatedId = createTerminalSessionId(() => '12345678-1234-4abc-8def-1234567890ab');

  assert.deepEqual(manager.list(), []);
  assert.match(generatedId, TERMINAL_SESSION_ID_PATTERN);
  assert.throws(
    () => new TerminalManager({ initialSessionIds: ['terminal-one'] }),
    /terminal UUID format/,
  );
  manager.dispose();
});

test('creates and lists any number of terminal sessions with stable ids', () => {
  const { manager } = createManagerHarness();
  const first = manager.create();
  const second = manager.create();
  const third = manager.create();

  assert.match(first.id, TERMINAL_SESSION_ID_PATTERN);
  assert.deepEqual(
    manager.list().map(({ id }) => id),
    [first.id, second.id, third.id],
  );
  assert.equal(manager.has(second.id), true);
  assert.throws(() => manager.create({ id: second.id }), /already exists/);
  assert.throws(() => manager.create({ id: 'terminal-manual' }), /UUID format/);

  manager.dispose();
});

test('routes dynamic terminal sessions and aggregate events independently', () => {
  const { manager, sessions } = createManagerHarness();
  const first = manager.create();
  const second = manager.create();
  const output = [];
  const exits = [];

  manager.onSessionData((event) => output.push(event));
  manager.onSessionExit((event) => exits.push(event));
  manager.start(first.id, { columns: 90, rows: 30 });
  manager.start(second.id, { columns: 100, rows: 35 });
  manager.write(first.id, 'first input');
  manager.write(second.id, 'second input');
  sessions.get(first.id).emitData('first response');
  sessions.get(second.id).emitData('second response');
  manager.resize(first.id, 120, 40);
  manager.kill(first.id);

  assert.deepEqual(sessions.get(first.id).writes, ['first input']);
  assert.deepEqual(sessions.get(second.id).writes, ['second input']);
  assert.deepEqual(output, [
    { id: first.id, data: 'first response' },
    { id: second.id, data: 'second response' },
  ]);
  assert.deepEqual(exits, [{ id: first.id, event: { exitCode: 0, signal: 0 } }]);
  assert.equal(manager.getSnapshot(first.id).isRunning, false);
  assert.equal(manager.getSnapshot(second.id).isRunning, true);

  manager.dispose();
});

test('restarts one dynamic session without changing another', async () => {
  const { manager, sessions } = createManagerHarness();
  const first = manager.create();
  const second = manager.create();

  manager.start(first.id);
  manager.start(second.id);
  const secondBeforeRestart = manager.getSnapshot(second.id);
  const restarted = await manager.restart(first.id, { cwd: 'C:\\new-worktree' });

  assert.equal(restarted.id, first.id);
  assert.equal(restarted.isRunning, true);
  assert.equal(sessions.get(first.id).killCount, 1);
  assert.equal(sessions.get(first.id).startOptions.at(-1).cwd, 'C:\\new-worktree');
  assert.deepEqual(manager.getSnapshot(second.id), secondBeforeRestart);
  assert.equal(sessions.get(second.id).killCount, 0);

  manager.dispose();
});

test('removes only the selected process tree and retires its id', () => {
  const { manager, sessions } = createManagerHarness();
  const first = manager.create();
  const second = manager.create();

  manager.start(first.id);
  manager.start(second.id);
  manager.remove(first.id);

  assert.equal(sessions.get(first.id).disposeCount, 1);
  assert.equal(sessions.get(first.id).killCount, 1);
  assert.equal(sessions.get(second.id).disposeCount, 0);
  assert.equal(sessions.get(second.id).killCount, 0);
  assert.equal(manager.getSnapshot(second.id).isRunning, true);
  assert.equal(manager.has(first.id), false);
  assert.throws(() => manager.getSnapshot(first.id), /Unknown terminal session/);
  assert.throws(() => manager.create({ id: first.id }), /retired/);
  assert.throws(() => manager.create({ id: second.id }), /already exists/);

  manager.dispose();
});

test('removal invokes complete process-tree cleanup only for its selected PTY', () => {
  const killedPids = [];
  let nextPid = 2001;
  let nextId = 10;
  const manager = new TerminalManager({
    sessionDefaults: { shell: 'shell.exe' },
    sessionFactory: (id) => {
      const processHandle = {
        pid: nextPid++,
        clear: () => undefined,
        kill: () => undefined,
        onData: () => ({ dispose: () => undefined }),
        onExit: () => ({ dispose: () => undefined }),
        resize: () => undefined,
        write: () => undefined,
      };

      return new TerminalSession({
        id,
        processTreeKiller: (pid) => {
          killedPids.push(pid);
          return true;
        },
        ptyModule: { spawn: () => processHandle },
      });
    },
    sessionIdFactory: () =>
      `terminal-00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
  });
  const first = manager.create();
  const second = manager.create();

  manager.start(first.id);
  manager.start(second.id);
  manager.remove(first.id);

  assert.deepEqual(killedPids, [2001]);
  assert.equal(manager.has(first.id), false);
  assert.equal(manager.getSnapshot(second.id).isRunning, true);

  manager.dispose();
  assert.deepEqual(killedPids, [2001, 2002]);
});

test('rejects unknown terminal ids and disposes every registered session', () => {
  const { manager, sessions } = createManagerHarness();
  const first = manager.create();
  const second = manager.create();

  assert.throws(() => manager.write('terminal-unknown', 'data'), /Unknown terminal session/);

  manager.start(first.id);
  manager.start(second.id);
  manager.dispose();

  assert.equal(sessions.get(first.id).disposeCount, 1);
  assert.equal(sessions.get(second.id).disposeCount, 1);
  assert.deepEqual(manager.list(), []);
});
