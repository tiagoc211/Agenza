const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const test = require('node:test');

const {
  CodexAppServerProvider,
} = require('../src/orchestration/providers/codex-app-server-provider');

const createFakeServer = ({ autoComplete = true } = {}) => {
  const child = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests = [];
  let input = '';
  const respond = (message) => stdout.write(`${JSON.stringify(message)}\n`);
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      input += chunk.toString();
      const lines = input.split('\n');
      input = lines.pop();
      for (const line of lines) {
        const request = JSON.parse(line);
        requests.push(request);
        if (request.method === 'initialize') respond({ id: request.id, result: {} });
        if (request.method === 'thread/start') {
          respond({ id: request.id, result: { thread: { id: 'thread-1' } } });
        }
        if (request.method === 'turn/start') {
          respond({
            id: request.id,
            result: { turn: { id: 'turn-1', status: 'inProgress', items: [] } },
          });
          if (autoComplete)
            process.nextTick(() => {
              respond({
                method: 'item/completed',
                params: {
                  threadId: 'thread-1',
                  item: { type: 'agentMessage', text: '{"answer":"done"}' },
                },
              });
              respond({
                method: 'turn/completed',
                params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
              });
            });
        }
        if (request.method === 'turn/interrupt') {
          respond({ id: request.id, result: {} });
          process.nextTick(() =>
            respond({
              method: 'turn/completed',
              params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } },
            }),
          );
        }
      }
      callback();
    },
  });
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.pid = 4321;
  child.kill = () => undefined;
  return { child, requests };
};

test('uses structured App Server threads and turns and returns the final agent item', async () => {
  const server = createFakeServer();
  const killed = [];
  const provider = new CodexAppServerProvider({
    createProcess: () => server.child,
    processTreeKiller: (pid) => {
      killed.push(pid);
      return true;
    },
  });
  const events = [];
  provider.onEvent((event) => events.push(event.type));

  const runtime = await provider.start({
    agentId: 'agent-1',
    cwd: 'C:\\worktree',
    instruction: 'Complete the task.',
    outputSchema: { type: 'object' },
    readOnly: true,
  });
  const completion = await provider.waitForCompletion('agent-1');

  assert.equal(runtime.threadId, 'thread-1');
  assert.equal(completion.status, 'completed');
  assert.equal(completion.result, '{"answer":"done"}');
  assert.deepEqual(
    server.requests.filter(({ method }) => method).map(({ method }) => method),
    ['initialize', 'initialized', 'thread/start', 'turn/start'],
  );
  assert.ok(events.includes('completed'));
  provider.dispose();
  assert.deepEqual(killed, [4321]);
});

test('interrupts one active turn without using terminal input', async () => {
  const server = createFakeServer({ autoComplete: false });
  const provider = new CodexAppServerProvider({
    createProcess: () => server.child,
    processTreeKiller: () => true,
  });
  await provider.start({
    agentId: 'agent-stop',
    cwd: 'C:\\worktree',
    instruction: 'Wait for stop.',
  });
  const stopped = await provider.stop('agent-stop');

  assert.equal(stopped.status, 'stopped');
  assert.ok(server.requests.some(({ method }) => method === 'turn/interrupt'));
  assert.ok(server.requests.every(({ method }) => method !== 'terminal/input'));
  provider.dispose();
});
