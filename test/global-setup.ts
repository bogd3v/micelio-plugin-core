import { execFileSync } from 'node:child_process'

/**
 * Builds the plugin once per run: the Strapi suites and the package test load `dist/`, as a host
 * that installed the package would. `@micelio/icons` is built too: its glyphs are not committed,
 * and the suites of the icons read them.
 */
export default function setup(): void {
  execFileSync('npm', ['run', 'build', '--silent'], { stdio: 'inherit' })
  execFileSync('npm', ['run', 'build', '--silent', '-w', '@micelio/icons'], { stdio: 'inherit' })
}
