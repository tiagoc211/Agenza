const commonGlobals = {
  __dirname: 'readonly',
  console: 'readonly',
  document: 'readonly',
  MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: 'readonly',
  MAIN_WINDOW_WEBPACK_ENTRY: 'readonly',
  module: 'readonly',
  process: 'readonly',
  require: 'readonly',
  window: 'readonly',
};

module.exports = [
  {
    ignores: ['.webpack/**', 'coverage/**', 'node_modules/**', 'out/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: commonGlobals,
    },
    rules: {
      eqeqeq: 'error',
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      sourceType: 'module',
    },
  },
];
