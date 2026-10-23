import { describe, expect, it } from 'vitest'
import { readTar, tarChunks, type TarEntry } from '../server/src/site-export/tar'

async function collect(chunks: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = []
  for await (const chunk of chunks) parts.push(chunk)
  return Buffer.concat(parts)
}

/** Reads an archive fed in chunks of `size` bytes, as a stream would. */
async function read(archive: Buffer, size = 7): Promise<[TarEntry, Buffer][]> {
  const entries: [TarEntry, Buffer][] = []
  async function* chunks(): AsyncGenerator<Buffer> {
    for (let offset = 0; offset < archive.length; offset += size) {
      yield archive.subarray(offset, offset + size)
    }
  }
  await readTar(chunks(), (entry) => {
    const parts: Buffer[] = []
    return {
      write: (chunk) => void parts.push(chunk),
      end: () => void entries.push([entry, Buffer.concat(parts)]),
    }
  })
  return entries
}

// Writes the checksum of the first header again, after a test changed a field of it.
function resum(archive: Buffer): void {
  archive.write('        ', 148, 'ascii')
  let sum = 0
  for (const byte of archive.subarray(0, 512)) sum += byte
  archive.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
}

describe('the ustar writer and reader', () => {
  const files = [
    { path: 'content/a.json', bytes: 3, body: Buffer.from('{}\n') },
    { path: 'content/empty.json', bytes: 0, body: Buffer.alloc(0) },
    { path: 'media/sha256/x', bytes: 1300, body: Buffer.alloc(1300, 7) },
  ]

  it('reads back what it wrote, whatever the size of the chunks', async () => {
    const archive = await collect(tarChunks(files))
    for (const size of [1, 7, 512, 100_000]) {
      const entries = await read(archive, size)
      expect(entries.map(([entry, body]) => [entry.path, entry.type, body])).toEqual(
        files.map((file) => [file.path, 'file', file.body])
      )
    }
  })

  it('refuses a body that is not the size announced', async () => {
    await expect(
      collect(tarChunks([{ path: 'a', bytes: 4, body: Buffer.from('abc') }]))
    ).rejects.toThrow(/3 bytes, not the 4/)
  })

  it('refuses a link, a wrong checksum and a truncated archive', async () => {
    const archive = await collect(tarChunks(files.slice(0, 1)))
    const link = Buffer.from(archive)
    link.write('2', 156, 'ascii')
    resum(link)
    await expect(read(link)).rejects.toThrow(/not a regular file or a directory/)
    const tampered = Buffer.from(archive)
    tampered.write('content/b.json', 0, 'utf8')
    await expect(read(tampered)).rejects.toThrow(/checksum/)
    await expect(read(archive.subarray(0, 600))).rejects.toThrow(/truncated/)
  })
})
