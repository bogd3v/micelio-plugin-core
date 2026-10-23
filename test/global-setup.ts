import { execFileSync } from 'node:child_process'

/**
 * Builds the plugin once per run: the Strapi suites and the package test load `dist/`, as a host
 * that installed the package would.
 */
export default function setup(): void {
  execFileSync('npm', ['run', 'build', '--silent'], { stdio: 'inherit' })
}
