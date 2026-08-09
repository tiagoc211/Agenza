const assert = require('node:assert/strict');
const test = require('node:test');

const { TerminalSession } = require('../src/terminal/terminal-session');

class FakePtyProcess {
  constructor() {
    this.pid = 4321;
    this.writes = [];
    this.resizes = [];
    this.clearCount = 0;
    this.killed = false;
    this._dataListener = null;
    this._exitListener = null;
  }

  onData(listener) {
    this._dataListener = listener;
    return { dispose: () => (this._dataListener = null) };
  }

  onExit(listener) {
    this._exitListener = listener;
    return { dispose: () => (this._exitListener = null) };
  }

  write(data) {
    this.writes.push(data);
  }

  resize(columns, rows) {
    this.resizes.push({ columns, rows });
  }

  clear() {
    this.clearCount += 1;
  }

  kill() {
    this.killed = true;
  }

  emitData(data) {
    this._dataListener?.(data);
  }

  emitExit(event) {
    this._exitListener?.(event);
  }
}

test('routes PTY input, output, resize, clear, and exit events', () => {
  const processHandle = new FakePtyProcess();
  let spawnCall;
  const session = new TerminalSession({
    id: 'terminal-one',
    ptyModule: {
      spawn: (...parameters) => {
        spawnCall = parameters;
        return processHandle;
      },
    },
  });
  const output = [];
  const exits = [];

  session.onData((data) => output.push(data));
  session.onExit((event) => exits.push(event));
  session.start({
    shell: 'shell.exe',
    args: ['--interactive'],
    cwd: 'C:\\project',
    env: { AGENZA_TEST: '✓', OMIT_ME: undefined },
    columns: 90,
    rows: 30,
  });

  assert.equal(spawnCall[0], 'shell.exe');
  assert.deepEqual(spawnCall[1], ['--interactive']);
  assert.equal(spawnCall[2].cols, 90);
  assert.equal(spawnCall[2].rows, 30);
  assert.equal(spawnCall[2].env.AGENZA_TEST, '✓');
  assert.equal('OMIT_ME' in spawnCall[2].env, false);

  session.write('olá 世界');
  session.resize(120, 40);
  session.clear();
  processHandle.emitData('resposta ✓');

  assert.deepEqual(processHandle.writes, ['olá 世界']);
  assert.deepEqual(processHandle.resizes, [{ columns: 120, rows: 40 }]);
  assert.equal(processHandle.clearCount, 1);
  assert.deepEqual(output, ['resposta ✓']);
  assert.deepEqual(session.dimensions, { columns: 120, rows: 40 });
  assert.equal(session.isRunning, true);
  assert.equal(session.kill(), true);
  assert.equal(processHandle.killed, true);

  processHandle.emitExit({ exitCode: 0 });

  assert.deepEqual(exits, [{ exitCode: 0 }]);
  assert.equal(session.isRunning, false);
  assert.equal(session.pid, null);
});

test('rejects unsafe state and invalid terminal dimensions', () => {
  const session = new TerminalSession({
    id: 'terminal-one',
    ptyModule: { spawn: () => new FakePtyProcess() },
  });

  assert.throws(() => session.write('hello'), /not running/);
  assert.throws(() => session.resize(0, 24), /columns/);
  assert.throws(() => session.start({ shell: '' }), /shell executable/);
  assert.throws(() => session.start({ shell: 'shell.exe', columns: 1001 }), /columns/);
});
