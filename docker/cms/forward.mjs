// A TCP forward: `node forward.mjs <listen port> <host:port>` listens on 127.0.0.1 and passes every
// connection to the target. compose.dev.yml uses it where a service must reach another at the address
// a browser uses (`localhost:<port>`), which inside a container is the container itself.

import net from 'node:net'

/**
 * Listens on `127.0.0.1:<listenPort>` and forwards each connection to `<host>:<port>`.
 *
 * @param {number} listenPort
 * @param {string} target - `host:port`
 */
export function forward(listenPort, target) {
  const [host, port] = target.split(':')
  return net
    .createServer((client) => {
      const upstream = net.connect(Number(port), host)
      client.pipe(upstream).pipe(client)
      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
    })
    .listen(listenPort, '127.0.0.1')
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  forward(Number(process.argv[2]), process.argv[3])
}
