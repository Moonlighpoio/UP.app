/**
 * UP · Configuración mínima de ESLint 9 (flat config).
 * Sin plugins externos: solo reglas del core y globals declarados a mano.
 */
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  location: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  requestAnimationFrame: 'readonly',
  tailwind: 'readonly',
};

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  __dirname: 'readonly',
  process: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  URL: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
};

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none' }],
  // `== null` es un chequeo nullish intencionado en cart.js y catalog.js.
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'prefer-const': 'error',
};

module.exports = [
  { ignores: ['node_modules/**', 'coverage/**', 'package-lock.json'] },
  {
    files: ['src/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...browserGlobals, ...nodeGlobals },
    },
    rules,
  },
  {
    files: ['server.js', 'data/demo.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...browserGlobals, ...nodeGlobals },
    },
    rules,
  },
];
