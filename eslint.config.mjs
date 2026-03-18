import js from '@eslint/js'
import { plugins as yenzPlugins, languageOptions as yenzLanguageOptions, rules as yenzRules } from 'eslint-config-yenz'

const eslintConfig = [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ...yenzLanguageOptions,
      parserOptions: {
        ...yenzLanguageOptions?.parserOptions,
        project: './tsconfig.json',
      },
    },
    plugins: {
      ...yenzPlugins,
    },
    rules: {
      ...yenzRules,
      'no-undef': 'off',
      'no-extra-boolean-cast': 'off',
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
        allowConciseArrowFunctionExpressionsStartingWithVoid: true,
      }],
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/only-throw-error': 'off',
      // VS Code extensions legitimately use console for output channel logging
      'no-console': 'off',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  {
    ignores: ['out/**', 'dist/**', 'esbuild.js', '.vscode-test/**'],
  },
]

export default eslintConfig
