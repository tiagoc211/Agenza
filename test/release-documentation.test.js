const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const readme = readFileSync('README.md', 'utf8');
const howToRun = readFileSync('HOWTORUN.md', 'utf8');

test('documents installation, usage, development, build, and release validation', () => {
  for (const heading of [
    '## User requirements',
    '## Install',
    '## Use Agenza',
    '## Development requirements',
    '## Tests and build commands',
    '## Troubleshooting',
    '## Known limitations in 0.1.0',
  ]) {
    assert.match(readme, new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }

  assert.match(readme, /Agenza-0\.1\.0 Setup\.exe/);
  assert.match(readme, /codex --version/);
  assert.match(readme, /Node\.js `22` or newer/);
  assert.match(readme, /npm run make/);
  assert.match(readme, /npm run test:release/);
  assert.match(readme, /not digitally signed/);
});

test('keeps runtime and agent development requirements separate', () => {
  assert.match(readme, /Users do not need Conda, Node\.js, or\s+npm/);
  assert.match(readme, /development workflow rule and is not an\s+application runtime dependency/);
  assert.doesNotMatch(howToRun, /conda/i);
  assert.match(howToRun, /codex --version/);
});

test('keeps every local README link valid', () => {
  const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
  const localLinks = links.filter((link) => !/^[a-z]+:/i.test(link) && !link.startsWith('#'));

  assert.ok(localLinks.length > 0);

  for (const link of localLinks) {
    assert.equal(existsSync(path.resolve(link)), true, `Missing README link target: ${link}`);
  }
});
