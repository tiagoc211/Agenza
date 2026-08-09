const assert = require('node:assert/strict');
const test = require('node:test');

const { TerminalManager } = require('../src/terminal/terminal-manager');

class FakeSession {
  constructor(id, pid) {
    this.id = id;
    this.pid = pid;
    this.isRunning = false;
    this.columns = 80;
    this.rows = 24;
    this.writes = [];
    this.dataListeners = new Set();
    this.exitListeners = new Set();
  }

  start(options) {
    this.isRunning = true;
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
    this.isRunning = false;
    for (const listener of this.exitListeners) {
      listener({ exitCode: 0 });
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
    this.isRunning = false;
  }
}

test('routes two terminal sessions independently', () => {
  const sessions = new Map();
  let nextPid = 1000;
  const manager = new TerminalManager({
    sessionDefaults: { shell: 'shell.exe' },
    sessionFactory: (id) => {
      const session = new FakeSession(id, nextPid++);
      sessions.set(id, session);
      return session;
    },
  });
  const firstOutput = [];
  const secondOutput = [];

  manager.onData('terminal-one', (data) => firstOutput.push(data));
  manager.onData('terminal-two', (data) => secondOutput.push(data));
  manager.startAll({
    'terminal-one': { columns: 90, rows: 30 },
    'terminal-two': { columns: 100, rows: 35 },
  });

  manager.write('terminal-one', 'olá 世界');
  manager.write('terminal-two', 'café ✓');
  sessions.get('terminal-one').emitData('first response');
  sessions.get('terminal-two').emitData('second response');
  manager.resize('terminal-one', 120, 40);

  assert.deepEqual(sessions.get('terminal-one').writes, ['olá 世界']);
  assert.deepEqual(sessions.get('terminal-two').writes, ['café ✓']);
  assert.deepEqual(firstOutput, ['first response']);
  assert.deepEqual(secondOutput, ['second response']);
  assert.equal(manager.getSnapshot('terminal-one').columns, 120);
  assert.equal(manager.getSnapshot('terminal-one').rows, 40);
  assert.equal(manager.getSnapshot('terminal-two').columns, 100);
  assert.equal(manager.getSnapshot('terminal-two').rows, 35);
  assert.notEqual(manager.getSnapshot('terminal-one').pid, manager.getSnapshot('terminal-two').pid);

  manager.kill('terminal-one');

  assert.equal(manager.getSnapshot('terminal-one').isRunning, false);
  assert.equal(manager.getSnapshot('terminal-two').isRunning, true);
});

test('rejects unknown terminal ids', () => {
  const manager = new TerminalManager({
    sessionFactory: (id) => new FakeSession(id, 1000),
  });

  assert.throws(() => manager.write('terminal-three', 'data'), /Unknown terminal session/);
});
