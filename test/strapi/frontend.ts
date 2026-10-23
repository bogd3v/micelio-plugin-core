// A stand-in for a site's frontend: answers `GET /_health` as micelio#702 will.

import http from 'node:http'
import type { AddressInfo } from 'node:net'

/** A frontend stub listening on 127.0.0.1. */
export interface FrontendStub {
  origin: string
  close(): Promise<void>
}

/**
 * Starts a frontend that answers `GET /_health` with `{ version }`, and 404 to anything else.
 *
 * @param version - The version it reports; `undefined` answers `{}`.
 */
export async function startFrontend(version?: string): Promise<FrontendStub> {
  const server = http.createServer((request, response) => {
    if (request.url !== '/_health') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(version === undefined ? {} : { version }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/** An origin nothing listens on: a frontend that refuses the connection. */
export async function closedOrigin(): Promise<string> {
  const stub = await startFrontend()
  await stub.close()
  return stub.origin
}
