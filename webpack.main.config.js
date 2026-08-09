const fs = require('node:fs');
const path = require('node:path');

class NodePtyRuntimePlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('NodePtyRuntimePlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'NodePtyRuntimePlugin',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          const platformDirectory = `${process.platform}-${process.arch}`;
          const moduleRoot = path.dirname(require.resolve('node-pty/package.json'));

          const emitDirectory = (sourceRoot, outputRoot, includeFile = () => true) => {
            const visit = (directory) => {
              for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const sourcePath = path.join(directory, entry.name);

                if (entry.isDirectory()) {
                  visit(sourcePath);
                  continue;
                }

                if (!includeFile(sourcePath)) {
                  continue;
                }

                const relativePath = path
                  .relative(sourceRoot, sourcePath)
                  .split(path.sep)
                  .join('/');
                const assetPath = `${outputRoot}/${relativePath}`;
                compilation.emitAsset(
                  assetPath,
                  new compiler.webpack.sources.RawSource(fs.readFileSync(sourcePath)),
                );
              }
            };

            visit(sourceRoot);
          };

          compilation.emitAsset(
            'node_modules/node-pty/package.json',
            new compiler.webpack.sources.RawSource(
              fs.readFileSync(path.join(moduleRoot, 'package.json')),
            ),
          );
          emitDirectory(
            path.join(moduleRoot, 'lib'),
            'node_modules/node-pty/lib',
            (sourcePath) => path.extname(sourcePath) === '.js' && !sourcePath.endsWith('.test.js'),
          );
          emitDirectory(
            path.join(moduleRoot, 'prebuilds', platformDirectory),
            `node_modules/node-pty/prebuilds/${platformDirectory}`,
            (sourcePath) => path.extname(sourcePath) !== '.pdb',
          );
        },
      );
    });
  }
}

module.exports = {
  devtool: 'source-map',
  entry: './src/main.js',
  // node-pty resolves native modules, workers, and helper scripts relative to its package folder.
  externals: {
    'node-pty': 'commonjs2 node-pty',
  },
  module: {
    rules: [
      {
        test: /native_modules\/.+\.node$/,
        use: 'node-loader',
      },
      {
        test: /\.(m?js|node)$/,
        parser: { amd: false },
        use: {
          loader: '@vercel/webpack-asset-relocator-loader',
          options: {
            outputAssetBase: 'native_modules',
          },
        },
      },
    ],
  },
  plugins: [new NodePtyRuntimePlugin()],
};
