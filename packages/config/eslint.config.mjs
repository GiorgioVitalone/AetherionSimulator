import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.*'],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Allowed deliberately: the engine compiles with `noUncheckedIndexedAccess`,
      // so `arr[i]` is `T | undefined`. Non-null assertions (`players[i]!`,
      // `arr[0]!` after a length check) are the idiomatic, readable way to express
      // an invariant the types can't see. Banning them here would force verbose
      // guards across the codebase for no safety gain, so this rule stays off.
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-exports': [
        'error',
        { restrictDefaultExports: { direct: true, named: true, defaultFrom: true } },
      ],
    },
  },
);
