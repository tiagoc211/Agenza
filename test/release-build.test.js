const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const forgeConfig = require('../forge.config');
const packageLock = require('../package-lock.json');
const packageJson = require('../package.json');
const {
  WORKSPACE_STATE_FILENAME,
  WorkspaceStateStore,
} = require('../src/workspace/workspace-state');

const RELEASE_VERSION = '0.2.0';
const TERMINAL_IDS = [
  'terminal-11111111-1111-4111-8111-111111111111',
  'terminal-22222222-2222-4222-8222-222222222222',
];

test('uses 0.2.0 metadata while retaining the 0.1.0 Squirrel upgrade identity', () => {
  const squirrelMaker = forgeConfig.makers.find(
    ({ name }) => name === '@electron-forge/maker-squirrel',
  );

  assert.equal(packageJson.name, 'agenza');
  assert.equal(packageJson.productName, 'Agenza');
  assert.equal(packageJson.version, RELEASE_VERSION);
  assert.equal(packageLock.version, RELEASE_VERSION);
  assert.equal(packageLock.packages[''].version, RELEASE_VERSION);
  assert.equal(squirrelMaker?.config?.name, 'agenza');
});

test('starts safely from 0.1.0 user data without changing existing files or Git work', async (context) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agenza-upgrade-test-'));
  const userDataDirectory = path.join(fixtureRoot, 'user-data');
  const existingWorktree = path.join(fixtureRoot, 'existing-worktree');
  const legacyLog = path.join(userDataDirectory, 'logs', 'agenza.log');
  const gitHead = path.join(existingWorktree, '.git', 'HEAD');
  const projectFile = path.join(existingWorktree, 'preserve-me.txt');
  context.after(() => fs.rm(fixtureRoot, { force: true, recursive: true }));

  await fs.mkdir(path.dirname(legacyLog), { recursive: true });
  await fs.mkdir(path.dirname(gitHead), { recursive: true });
  await fs.writeFile(legacyLog, 'legacy 0.1.0 diagnostics\n', 'utf8');
  await fs.writeFile(gitHead, 'ref: refs/heads/main\n', 'utf8');
  await fs.writeFile(projectFile, 'existing Git work\n', 'utf8');

  let idIndex = 0;
  const store = new WorkspaceStateStore({
    directory: userDataDirectory,
    idFactory: () => TERMINAL_IDS[idIndex++],
    now: () => '2026-08-20T12:00:00.000Z',
  });
  const loaded = await store.load();

  assert.equal(loaded.source, 'default');
  assert.equal(loaded.state.schemaVersion, 1);
  assert.equal(loaded.state.terminals.length, 2);
  assert.equal(await fs.readFile(legacyLog, 'utf8'), 'legacy 0.1.0 diagnostics\n');
  assert.equal(await fs.readFile(gitHead, 'utf8'), 'ref: refs/heads/main\n');
  assert.equal(await fs.readFile(projectFile, 'utf8'), 'existing Git work\n');
  assert.equal(
    JSON.parse(await fs.readFile(path.join(userDataDirectory, WORKSPACE_STATE_FILENAME), 'utf8'))
      .schemaVersion,
    1,
  );
});

test('ships actionable Codex and Git prerequisite guidance with dynamic terminal controls', async () => {
  const [main, gitCommand, rendererMarkup] = await Promise.all([
    fs.readFile(path.join(__dirname, '..', 'src', 'main.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '..', 'src', 'git', 'git-command.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8'),
  ]);

  assert.match(main, /Codex CLI was not found on PATH.*normal terminal.*restart Agenza/s);
  assert.match(gitCommand, /Git was not found on PATH.*Install Git.*restart Agenza/);
  assert.match(rendererMarkup, /data-add-terminal/);
  assert.match(rendererMarkup, /id="terminal-pane-template"/);
  assert.match(rendererMarkup, />Git workspace</);
});
