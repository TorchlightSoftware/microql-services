import stylistic from '@stylistic/eslint-plugin'
import js from '@eslint/js'

// The same style as MicroQL's own, so a service reads like the core it extends.
export default [
  js.configs.recommended,
  {
    ignores: ['**/node_modules/**']
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly'
      }
    },
    plugins: {
      '@stylistic': stylistic
    },
    rules: {
      '@stylistic/indent': ['error', 2],
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/object-curly-spacing': ['error', 'never'],
      '@stylistic/object-curly-newline': ['error', {
        ObjectExpression: {multiline: true, consistent: true},
        ObjectPattern: {multiline: true, consistent: true}
      }],
      '@stylistic/array-bracket-spacing': ['error', 'never'],
      '@stylistic/array-bracket-newline': ['error', 'consistent'],
      '@stylistic/array-element-newline': ['error', 'consistent'],
      '@stylistic/comma-spacing': ['error', {before: false, after: true}],
      '@stylistic/key-spacing': ['error', {beforeColon: false, afterColon: true}],
      '@stylistic/quote-props': ['error', 'as-needed'],
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/no-multi-spaces': 'error',
      '@stylistic/space-before-function-paren': ['error', {
        anonymous: 'always',
        named: 'never',
        asyncArrow: 'always'
      }],
      '@stylistic/function-paren-newline': ['error', 'consistent'],
      '@stylistic/function-call-spacing': ['error', 'never'],
      '@stylistic/brace-style': ['error', '1tbs', {allowSingleLine: true}],
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/space-unary-ops': 'error',
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }]
    }
  },
  {
    // functions handed to the browser run in the page, where the DOM is
    files: ['services/scraper/in-page.js'],
    languageOptions: {globals: {document: 'readonly', DOMParser: 'readonly', Node: 'readonly', NodeFilter: 'readonly', XPathResult: 'readonly', getComputedStyle: 'readonly', requestAnimationFrame: 'readonly'}}
  }
]
