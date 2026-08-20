const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const howToRun = readFileSync('HOWTORUN.md', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const releaseNotes = readFileSync('docs/release-notes-0.2.0.md', 'utf8');

test('documents 0.2.0 installation, dynamic terminals, Git workspaces, and build validation', () => {
  for (const heading of [
    '## User requirements',
    '## Install or upgrade',
    '## Use Agenza',
    '### Create a new branch and worktree',
    '### Use an existing branch or worktree',
    '### Remove a terminal safely',
    '### Clean an Agenza-created worktree',
    '### Recover stale workspace state',
    '## Safety boundaries',
    '## Development requirements',
    '## Tests and build commands',
    '## Troubleshooting',
    '## Known limitations in 0.2.0',
  ]) {
    assert.match(readme, new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }

  assert.match(readme, /Agenza-0\.2\.0 Setup\.exe/);
  assert.match(readme, /zero, one, two, or several terminal definitions/);
  assert.match(readme, /Create a new branch/);
  assert.match(readme, /Use an existing local branch/);
  assert.match(readme, /Attach a registered worktree/);
  assert.match(readme, /npm run make/);
  assert.match(readme, /npm run test:release/);
});

test('documents ownership, removal, cleanup, recovery, privacy, and excluded Git operations', () => {
  for (const requiredGuidance of [
    /Removing a terminal never deletes/,
    /lists only unassigned worktrees that Agenza\s+previously created/,
    /Cleanup uses normal, non-forced `git worktree remove`/,
    /never deletes its local branch/,
    /Detach does not delete/,
    /does\s+not run `git worktree prune`/,
    /never terminal input/,
    /does not automatically merge, rebase, cherry-pick, commit, fetch, pull, push/,
  ]) {
    assert.match(readme, requiredGuidance);
  }
});

test('provides actionable Codex, Git, cleanup, stale-state, and installer troubleshooting', () => {
  for (const heading of [
    '### Codex CLI was not found on PATH',
    '### Git was not found on PATH',
    '### A Git workspace cannot be created or attached',
    '### Worktree cleanup is refused',
    '### A saved workspace is stale',
    '### The saved workspace state cannot be loaded',
    '### Windows warns about the installer',
  ]) {
    assert.match(readme, new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }

  assert.match(readme, /codex --version/);
  assert.match(readme, /git --version/);
  assert.match(readme, /git status/);
  assert.match(readme, /git worktree list/);
  assert.match(readme, /not code-signed/);
});

test('keeps runtime and agent development requirements separate', () => {
  assert.match(readme, /Users do not need Conda,\s+Node\.js, or npm/);
  assert.match(readme, /development workflow rule and is not an\s+application runtime dependency/);
  assert.doesNotMatch(howToRun, /conda/i);
  assert.match(howToRun, /codex --version/);
});

test('publishes complete 0.2.0 release notes and changelog entries', () => {
  for (const heading of [
    '# Agenza 0.2.0',
    '## Highlights',
    '## Install or upgrade',
    '## Requirements',
    '## Git workspace workflow',
    '## Removal, cleanup, and recovery safety',
    '## Privacy and diagnostics',
    '## Release verification',
    '## Known limitations',
  ]) {
    assert.match(
      releaseNotes,
      new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
    );
  }

  assert.match(releaseNotes, /Agenza-0\.2\.0 Setup\.exe/);
  assert.match(releaseNotes, /complete unit and integration suite/);
  assert.match(changelog, /^## \[0\.2\.0\] - 2026-08-20$/m);
  assert.match(changelog, /^\[0\.2\.0\]: .*\/v0\.2\.0$/m);
});

test('keeps every local README and release-note link valid', () => {
  const linkedDocuments = [
    { filePath: 'README.md', source: readme },
    { filePath: 'docs/release-notes-0.2.0.md', source: releaseNotes },
  ];

  for (const { filePath, source } of linkedDocuments) {
    const baseDirectory = path.dirname(filePath);
    const links = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
    const localLinks = links.filter((link) => !/^[a-z]+:/i.test(link) && !link.startsWith('#'));

    assert.ok(localLinks.length > 0);

    for (const link of localLinks) {
      assert.equal(
        existsSync(path.resolve(baseDirectory, link)),
        true,
        `Missing link target in ${filePath}: ${link}`,
      );
    }
  }
});
