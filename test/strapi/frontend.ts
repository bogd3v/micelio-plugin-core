// A stand-in for a site's frontend: answers `GET /_health` as micelio#702 will.

import http from 'node:http'
import type { AddressInfo } from 'node:net'

/** A frontend stub listening on 127.0.0.1. */
export interface FrontendStub {
  origin: string
  /** How many `GET /_health` it has answered. */
  readonly healthRequests: number
  close(): Promise<void>
}

/**
 * Starts a frontend that answers `GET /_health` with `{ version }`, and 404 to anything else.
 *
 * @param version - The version it reports; `undefined` answers `{}`.
 * @param port - A port to listen on, such as one `closedOrigin` gave; any free port by default.
 */
export async function startFrontend(version?: string, port = 0): Promise<FrontendStub> {
  let healthRequests = 0
  const server = http.createServer((request, response) => {
    if (request.url !== '/_health') {
      response.writeHead(404).end()
      return
    }
    healthRequests++
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(version === undefined ? {} : { version }))
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${address.port}`,
    get healthRequests() {
      return healthRequests
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/** An origin nothing listens on: a frontend that refuses the connection. */
export async function closedOrigin(): Promise<string> {
  const stub = await startFrontend()
  await stub.close()
  return stub.origin
}
