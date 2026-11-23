/* ESLint flat config: backend runs in Node, frontend in the browser. */

const RULES = {
  'no-undef': 'error',
  'no-unused-vars': [
    'error',
    {
      args: 'after-used',
      argsIgnorePattern: '^_',
      caughtErrors: 'none',
      // Allow omitting a field by destructuring it: const { secret, ...rest } = row.
      ignoreRestSiblings: true,
    },
  ],
  'no-var': 'error',
  'prefer-const': 'warn',
  eqeqeq: ['warn', 'always'],
};

const NODE_GLOBALS = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
};

const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  location: 'readonly',
  history: 'readonly',
  localStorage: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  FormData: 'readonly',
  FileReader: 'readonly',
  Blob: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  confirm: 'readonly',
  alert: 'readonly',
};

module.exports = [
  { ignores: ['**/node_modules/**', 'backend/data/**', '.shots/**'] },
  {
    files: ['backend/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: NODE_GLOBALS,
    },
    rules: RULES,
  },
  {
    files: ['frontend/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: BROWSER_GLOBALS,
    },
    rules: RULES,
  },
];
