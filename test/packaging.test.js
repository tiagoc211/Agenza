const assert = require('node:assert/strict');
const test = require('node:test');

const forgeConfig = require('../forge.config');
const webpackConfig = require('../webpack.main.config');

test('packages the complete node-pty runtime outside the main Webpack bundle', () => {
  const emittedAssets = new Set();
  const compilation = {
    emitAsset: (name) => emittedAssets.add(name),
    hooks: {
      processAssets: {
        tap: (_options, callback) => callback(),
      },
    },
  };
  const compiler = {
    hooks: {
      thisCompilation: {
        tap: (_name, callback) => callback(compilation),
      },
    },
    webpack: {
      Compilation: {
        PROCESS_ASSETS_STAGE_ADDITIONAL: 0,
      },
      sources: {
        RawSource: class RawSource {
          constructor(content) {
            this.content = content;
          }
        },
      },
    },
  };

  assert.equal(webpackConfig.externals['node-pty'], 'commonjs2 node-pty');
  webpackConfig.plugins[0].apply(compiler);

  assert.ok(emittedAssets.has('node_modules/node-pty/lib/worker/conoutSocketWorker.js'));
  assert.ok(emittedAssets.has('node_modules/node-pty/lib/conpty_console_list_agent.js'));
  assert.ok(emittedAssets.has('node_modules/node-pty/prebuilds/win32-x64/conpty.node'));
  assert.match(forgeConfig.packagerConfig.asar.unpack, /node_modules\/node-pty/);
});
