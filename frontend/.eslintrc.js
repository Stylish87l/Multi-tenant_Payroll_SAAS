// .eslintrc.cjs
const js = require('@eslint/js');

module.exports = {
  root: true,
  // Base recommended rules from ESLint core
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    // Optional: enable accessibility checks if you install the plugin
    // 'plugin:jsx-a11y/recommended',
  ],
  plugins: ['react', 'react-hooks'],
  overrides: [
    {
      files: ['**/*.{js,jsx}'],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        parserOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
          ecmaFeatures: { jsx: true },
        },
        globals: {
          window: 'readonly',
          document: 'readonly',
          localStorage: 'readonly',
          navigator: 'readonly',
          process: 'readonly',
          import: 'readonly',
        },
      },
      settings: {
        react: { version: 'detect' },
      },
      rules: {
        /***** Core React Security and Hygiene *****/
        'react/prop-types': 'off', // using runtime validation or TS/Zod instead
        'react/react-in-jsx-scope': 'off', // not required with modern React
        'react/no-danger': 'error', // prevent XSS via dangerouslySetInnerHTML

        /***** Hook Integrity (critical) *****/
        'react-hooks/rules-of-hooks': 'error', // enforce hook rules
        'react-hooks/exhaustive-deps': 'warn', // ensure effect deps are correct

        /***** General Code Quality *****/
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        'no-console': ['warn', { allow: ['warn', 'error'] }], // avoid accidental token logging
        eqeqeq: ['error', 'always'],

        /***** Accessibility & Security Suggestions (opt-in) *****/
        // If you install eslint-plugin-jsx-a11y, enable these:
        // 'jsx-a11y/anchor-is-valid': 'warn',
        // 'jsx-a11y/no-noninteractive-element-interactions': 'warn',

        /***** Optional stricter rules you may enable later *****/
        // 'complexity': ['warn', 12],
        // 'max-lines': ['warn', { max: 400 }],
      },
    },
    {
      // Node / config files
      files: ['*.cjs', '*.config.js'],
      env: { node: true },
      rules: {
        'no-console': 'off',
      },
    },
    {
      // Test files
      files: ['**/*.test.{js,jsx}', '**/__tests__/**/*.{js,jsx}'],
      env: { jest: true },
      rules: {
        'no-unused-expressions': 'off',
      },
    },
  ],
};
