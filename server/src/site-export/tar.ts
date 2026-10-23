// A POSIX ustar writer for the regular files of an archive (`docs/export-format.md`, "The
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
