// A stand-in for the theme routes of a site's frontend: `GET /api/theme/status` (bogd3v/micelio#403)
// and `GET /api/theme/catalogue` (bogd3v/micelio#993), with a switch that plays the frontend's: it
// reads the site's pin and makes active a theme the image was built with, or a data-only theme of the
// catalogue, and refuses a code theme the image lacks (ADR-0009 of micelio, sections 3 and 4).

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type {
  CatalogueVersion,
  FrontendThemeCatalogue,
  FrontendThemeStatus,
  ThemeIdentity,
  ThemePin,
} from '../../server/src/types/themes'

/** How the stub's theme routes answer; a test changes it while the stub runs. */
export interface ThemeBehaviour {
  /** Both routes answer `503`, as a frontend that is down. */
  isDown: boolean
  /** The themes compiled into the stub's image; the first is the instance's default. */
  builtIn: FrontendThemeStatus['available']['builtIn']
  catalogue: FrontendThemeCatalogue
  /** Reads the site's pin, as the frontend reads its site settings; none by default. */
  readPin: () => Promise<ThemePin | null>
}

/** The stub's theme routes, which also say what a preview of a theme would render. */
export interface ThemeRoutes {
  behaviour: ThemeBehaviour
  /** Answers a theme route; `false` when the request is not one. */
  answer: (request: http.IncomingMessage, response: http.ServerResponse) => Promise<boolean>
  /** The theme the stub renders now, after switching to the site's pin. */
  active: () => Promise<ThemeIdentity>
  /** Whether a store of the stub holds that version of a theme, as `/_preview` decides `themeNotInstalled`. */
  isInstalled: (theme: { id: string; version: string }) => boolean
}

/** A stub frontend that answers the theme routes alone. */
export interface ThemeSite {
  origin: string
  themes: ThemeRoutes
  close: () => Promise<void>
}

const digestOf = (id: string, version: string) =>
  `sha256:${Buffer.from(`${id}@${version}`).toString('hex').padEnd(64, '0').slice(0, 64)}`

/**
 * The stub's image and catalogue: `bogota` (a code theme the image was built with, the default) and
 * `starter` (data-only) built in, each with the `name`, `modes` and `layout` of bogd3v/micelio#1018,
 * and each report with its `checks` and `accessibility`; `sendero`, a data-only theme of the registry the stub installs at
 * runtime; `mosaico`, a code theme of the registry the image was not built with.
 */
export function newThemeBehaviour(): ThemeBehaviour {
  const report = (id: string, version: string, ok = true) => ({
    id,
    version,
    digest: digestOf(`report-${id}`, version),
    ok,
    summary: ok
      ? `${id} ${version}: AA contrast, axe clean, budgets pass.`
      : `${id} ${version}: contrast fails.`,
    checks: ok
      ? { static: 'passed' as const, quality: 'passed' as const, performance: 'passed' as const }
      : { static: 'passed' as const, quality: 'failed' as const, performance: 'passed' as const },
    // Only bogota's report records the manual accessibility check, for the version it admitted.
    accessibility:
      id === 'bogota' ? { status: 'passed' as const, current: true, date: '2026-10-18' } : null,
  })
  const version = (
    id: string,
    number: string,
    code: boolean,
    extra: Partial<CatalogueVersion> = {}
  ): CatalogueVersion => ({
    version: number,
    digest: digestOf(id, number),
    contract: '2.3',
    license: 'MIT',
    tier: 'official',
    status: 'published',
    code,
    report: digestOf(`report-${id}`, number),
    runs: true,
    ...extra,
  })
  return {
    isDown: false,
    builtIn: [
      { id: 'bogota', version: '1.0.0', code: true },
      { id: 'starter', version: '1.2.0', code: false },
    ],
    catalogue: {
      installed: [
        {
          id: 'bogota',
          version: '1.0.0',
          packageDigest: digestOf('bogota', '1.0.0'),
          contract: '2.3',
          code: true,
          store: 'built-in',
          report: digestOf('report-bogota', '1.0.0'),
          name: 'Bogotá',
          modes: [
            { id: 'claro', scheme: 'light' },
            { id: 'oscuro', scheme: 'dark' },
          ],
          layout: {
            header: 'bar',
            home: 'showcase',
            postList: 'list',
            article: 'aside',
            footer: 'minimal',
          },
        },
        {
          id: 'starter',
          version: '1.2.0',
          packageDigest: digestOf('starter', '1.2.0'),
          contract: '2.3',
          code: false,
          store: 'built-in',
          report: digestOf('report-starter', '1.2.0'),
          name: 'Starter',
          modes: [
            { id: 'light', scheme: 'light' },
            { id: 'dark', scheme: 'dark' },
          ],
          layout: {
            header: 'centered',
            home: 'index',
            postList: 'list',
            article: 'centered',
            footer: 'minimal',
          },
        },
      ],
      registry: [
        {
          id: 'starter',
          versions: [version('starter', '1.3.0', false), version('starter', '1.2.0', false)],
        },
        { id: 'sendero', versions: [version('sendero', '2.1.0', false)] },
        { id: 'mosaico', versions: [version('mosaico', '0.9.0', true, { tier: 'community' })] },
      ],
      reason: null,
      updates: [
        {
          id: 'starter',
          from: '1.2.0',
          store: 'built-in',
          version: '1.3.0',
          digest: digestOf('starter', '1.3.0'),
        },
      ],
      reports: [
        report('bogota', '1.0.0'),
        report('starter', '1.2.0'),
        report('starter', '1.3.0'),
        report('sendero', '2.1.0'),
        report('mosaico', '0.9.0', false),
      ],
    },
    readPin: async () => null,
  }
}

/** The theme routes of a stub frontend, with the switch's state. */
export function themeRoutes(behaviour: ThemeBehaviour = newThemeBehaviour()): ThemeRoutes {
  const identityOf = (id: string, version: string | undefined): ThemeIdentity => ({
    id,
    ...(version ? { version } : {}),
    digest: digestOf(`entry-${id}`, version ?? ''),
    packageDigest: digestOf(id, version ?? ''),
  })
  const builtInIdentity = (id: string) =>
    identityOf(id, behaviour.builtIn.find((theme) => theme.id === id)?.version)
  let active: ThemeIdentity | undefined
  let lastGood: ThemeIdentity | null = null
  let error: FrontendThemeStatus['error'] = null
  let requested: FrontendThemeStatus['requested'] = null

  // The switch of the frontend, run on each read of the status: the pin decides, a refusal keeps the active theme.
  async function settle(): Promise<ThemeIdentity> {
    const defaultTheme = builtInIdentity(behaviour.builtIn[0]!.id)
    active ??= defaultTheme
    const pin = await behaviour.readPin()
    requested = pin?.themeId
      ? {
          id: pin.themeId,
          ...(pin.themeVersion ? { version: pin.themeVersion } : {}),
          ...(pin.themeDigest ? { digest: pin.themeDigest } : {}),
        }
      : null
    let target: ThemeIdentity | null = null
    if (!pin?.themeId) target = defaultTheme
    else if (!pin.themeVersion && !pin.themeDigest) {
      target = behaviour.builtIn.some(({ id }) => id === pin.themeId)
        ? builtInIdentity(pin.themeId)
        : null
      if (!target)
        error = {
          rule: 'unknown',
          message: 'the image has no such theme',
          at: new Date().toISOString(),
          requested,
        }
    } else {
      const listed = behaviour.catalogue.registry
        ?.find(({ id }) => id === pin.themeId)
        ?.versions.find(
          ({ version, digest }) => version === pin.themeVersion && digest === pin.themeDigest
        )
      if (listed && !listed.code) target = identityOf(pin.themeId, pin.themeVersion ?? undefined)
      else
        error = {
          rule: listed ? 'code' : 'registry',
          message: listed
            ? 'the theme ships code, which only an image built with it can run'
            : 'the registry does not list it',
          at: new Date().toISOString(),
          requested,
        }
    }
    if (target && target.packageDigest !== active.packageDigest) {
      lastGood = active
      active = target
      error = null
    } else if (target) error = null
    return active
  }

  return {
    behaviour,
    active: settle,
    isInstalled: ({ id, version }) =>
      behaviour.catalogue.installed.some((theme) => theme.id === id && theme.version === version),
    answer: async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://stub').pathname
      if (path !== '/api/theme/status' && path !== '/api/theme/catalogue') return false
      if (behaviour.isDown) {
        response.writeHead(503).end()
        return true
      }
      const body =
        path === '/api/theme/catalogue'
          ? behaviour.catalogue
          : ({
              active: await settle(),
              requested,
              lastGood,
              error,
              available: {
                builtIn: behaviour.builtIn,
                registry: { install: true, tiers: ['official'] },
              },
            } satisfies FrontendThemeStatus & { available: { registry: unknown } })
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(body))
      return true
    },
  }
}

/** Starts a stub frontend on 127.0.0.1 that answers the theme routes and 404 to anything else. */
export async function startThemeSite(behaviour?: ThemeBehaviour): Promise<ThemeSite> {
  const themes = themeRoutes(behaviour)
  const server = http.createServer(async (request, response) => {
    try {
      if (!(await themes.answer(request, response))) response.writeHead(404).end()
    } catch {
      // A failing stub answers 500 so a test fails on the answer, not on a hung request.
      response.writeHead(500).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    themes,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
