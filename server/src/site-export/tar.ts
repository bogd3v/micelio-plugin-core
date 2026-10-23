// A POSIX ustar writer and reader for the regular files of an archive (`docs/export-format.md`, "The
// archive"). Every path of format 1.0 fits the 100 bytes of the name field, so no pax header or
// prefix is ever needed, and the times, owners and modes are fixed so that an archive is
// deterministic.

const BLOCK = 512
const NAME_LENGTH = 100
// The largest size the 11 octal digits of the size field hold: 8 GiB minus one byte.
const MAX_SIZE = 0o77777777777

/** A file to write: its path in the archive, its size and its bytes. */
export interface TarFile {
  path: string
  bytes: number
  body: Buffer | AsyncIterable<Buffer>
}

/**
 * The chunks of a tar archive of `files`, in the order given.
 *
 * @throws `Error` when a path does not fit, or when a body is not the size it was announced with.
 */
export async function* tarChunks(
  files: AsyncIterable<TarFile> | Iterable<TarFile>
): AsyncGenerator<Buffer> {
  for await (const file of files) {
    yield header(file.path, file.bytes)
    let written = 0
    const body = Buffer.isBuffer(file.body) ? [file.body] : file.body
    for await (const chunk of body) {
      written += chunk.length
      yield chunk
    }
    if (written !== file.bytes) {
      throw new Error(`${file.path} has ${written} bytes, not the ${file.bytes} announced`)
    }
    const padding = (BLOCK - (file.bytes % BLOCK)) % BLOCK
    if (padding > 0) yield Buffer.alloc(padding)
  }
  // The end of the archive: two empty blocks.
  yield Buffer.alloc(BLOCK * 2)
}

function header(path: string, bytes: number): Buffer {
  const name = Buffer.from(path, 'utf8')
  if (name.length > NAME_LENGTH) throw new Error(`${path} is longer than ${NAME_LENGTH} bytes`)
  if (bytes > MAX_SIZE) throw new Error(`${path} is larger than a tar entry holds`)
  const block = Buffer.alloc(BLOCK)
  name.copy(block, 0)
  block.write('0000644\0', 100, 'ascii') // mode
  block.write('0000000\0', 108, 'ascii') // uid
  block.write('0000000\0', 116, 'ascii') // gid
  block.write(`${bytes.toString(8).padStart(11, '0')}\0`, 124, 'ascii')
  block.write('00000000000\0', 136, 'ascii') // mtime
  block.write('        ', 148, 'ascii') // the checksum counts as spaces while it is computed
  block.write('0', 156, 'ascii') // a regular file
  block.write('ustar\0', 257, 'ascii')
  block.write('00', 263, 'ascii')
  let sum = 0
  for (const byte of block) sum += byte
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  return block
}

/** An entry of an archive being read. */
export interface TarEntry {
  path: string
  type: 'file' | 'directory'
  bytes: number
}

/** Where the bytes of one file of an archive go. */
export interface TarSink {
  write(chunk: Buffer): void | Promise<void>
  end(): void | Promise<void>
}

/**
 * Reads a tar archive and hands each file's bytes to the sink `open` gives for it.
 *
 * @remarks
 * Only regular files and directories are read: any other entry (a link, a device, a pax or GNU
 * extension header) refuses the archive before its body is read, and so does a header whose
 * checksum is wrong. `open` sees each entry first and may throw to refuse it.
 *
 * @throws `Error` for an entry that is not a file or a directory, a bad checksum, or a truncated
 * archive; what `open` or a sink throws.
 */
export async function readTar(
  source: AsyncIterable<Buffer>,
  open: (entry: TarEntry) => TarSink | Promise<TarSink>
): Promise<void> {
  let buffer: Buffer = Buffer.alloc(0)
  let current: { sink: TarSink; remaining: number; padding: number } | undefined
  let ended = false
  for await (const chunk of source) {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
    for (;;) {
      if (ended) break
      if (current) {
        if (current.remaining > 0) {
          if (buffer.length === 0) break
          const body = buffer.subarray(0, Math.min(current.remaining, buffer.length))
          buffer = buffer.subarray(body.length)
          current.remaining -= body.length
          await current.sink.write(body)
          if (current.remaining > 0) break
          await current.sink.end()
        }
        if (buffer.length < current.padding) break
        buffer = buffer.subarray(current.padding)
        current = undefined
      }
      if (buffer.length < BLOCK) break
      const block = buffer.subarray(0, BLOCK)
      buffer = buffer.subarray(BLOCK)
      if (block.every((byte) => byte === 0)) {
        ended = true
        break
      }
      const entry = parseHeader(block)
      const sink = await open(entry)
      current = { sink, remaining: entry.bytes, padding: (BLOCK - (entry.bytes % BLOCK)) % BLOCK }
      if (entry.bytes === 0) await sink.end()
    }
  }
  if (!ended || (current && current.remaining > 0)) throw new Error('The archive is truncated')
}

function parseHeader(block: Buffer): TarEntry {
  const stored = Number.parseInt(field(block, 148, 8), 8)
  let sum = 0
  for (let position = 0; position < BLOCK; position += 1) {
    sum += position >= 148 && position < 156 ? 0x20 : block[position]!
  }
  if (sum !== stored) throw new Error('A tar header has a wrong checksum')
  const prefix = field(block, 345, 155)
  const name = field(block, 0, NAME_LENGTH)
  const path = prefix ? `${prefix}/${name}` : name
  const flag = String.fromCharCode(block[156]!)
  const bytes = Number.parseInt(field(block, 124, 12) || '0', 8)
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`${path} has no valid size`)
  if (flag === '0' || flag === '\0') return { path, type: 'file', bytes }
  if (flag === '5') return { path, type: 'directory', bytes: 0 }
  throw new Error(`${path} is not a regular file or a directory`)
}

function field(block: Buffer, start: number, length: number): string {
  const raw = block.subarray(start, start + length)
  const end = raw.indexOf(0)
  return (end === -1 ? raw : raw.subarray(0, end)).toString('utf8').trim()
}
