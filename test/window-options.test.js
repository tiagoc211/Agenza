const assert = require('node:assert/strict');
const test = require('node:test');

const { createWindowOptions } = require('../src/window-options');

test('creates a secure renderer configuration', () => {
  const options = createWindowOptions('preload.js');

  assert.equal(options.webPreferences.preload, 'preload.js');
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.webPreferences.allowRunningInsecureContent, false);
});
