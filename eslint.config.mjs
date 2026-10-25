import micelio from '@micelio/eslint-config'

export default [
  ...micelio,
  {
    // CommonJS, as Strapi loads them: the root entry files, the CLI and the configuration of the
    // test app and of the Strapi project of compose.dev.yml.
    files: ['strapi-*.js', 'bin/*.js', 'test/strapi/app/**/*.js', 'docker/cms/**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // The admin customisation of the test app is an ES module: the admin's bundler imports it.
    files: ['test/strapi/app/src/admin/**/*.js', 'docker/cms/src/admin/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
  {
    // What Strapi generates in the project of compose.dev.yml (gitignored).
    ignores: [
      'dist/**',
      'test/strapi/app/build/**',
      'docker/cms/types/**',
      'docker/cms/.strapi/**',
      'docker/cms/build/**',
      'docker/cms/dist/**',
      'docker/cms/public/**',
    ],
  },
]
