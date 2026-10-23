import micelio from '@micelio/eslint-config'

export default [
  ...micelio,
  {
    // CommonJS, as Strapi loads them: the root entry files, the CLI and the configuration of the
    // test app.
    files: ['strapi-*.js', 'bin/*.js', 'test/strapi/app/**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  { ignores: ['dist/**'] },
]
