/** ESLint flat configuration for browser modules and Node tooling. */
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';

export default [
  {
    ignores: [
      'node_modules/**',
      '.npm-cache/**',
      '.generated/**',
      '.build/**',
      'public/**',
      'resources/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: { jsdoc },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'jsdoc/require-jsdoc': [
        'error',
        {
          require: {
            FunctionDeclaration: true,
            FunctionExpression: true,
            ArrowFunctionExpression: false,
            MethodDefinition: true,
          },
        },
      ],
    },
  },
  {
    files: ['assets/js/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
];
