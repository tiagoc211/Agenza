const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  CMD_SOURCE,
  POWERSHELL_SOURCE,
  installAgentCli,
} = require('../src/orchestration/agent-cli');

test('installs a token-free agent CLI wrapper in application data', () => {
  const writes = [];
  const directories = [];
  const directory = path.resolve('temporary-user-data');
  const result = installAgentCli({
    directory,
    fsModule: {
      mkdirSync: (target, options) => directories.push({ options, target }),
      writeFileSync: (target, contents, options) => writes.push({ contents, options, target }),
    },
  });

  assert.equal(result, path.join(directory, 'orchestration-tools'));
  assert.equal(directories[0].options.recursive, true);
  assert.equal(writes.length, 2);
  assert.match(POWERSHELL_SOURCE, /AGENZA_AGENT_TOKEN/);
  assert.match(POWERSHELL_SOURCE, /agenza-agent send/);
  assert.match(CMD_SOURCE, /ExecutionPolicy Bypass/);
  assert.doesNotMatch(`${POWERSHELL_SOURCE}${CMD_SOURCE}`, /Bearer [A-Za-z0-9_-]{10}/);
});
