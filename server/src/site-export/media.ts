// The original bytes of a stored file, wherever the upload provider keeps them.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { Core } from '@strapi/strapi'
import { ExportError } from './errors'

/** The fields of a stored file that locate its bytes. */
export interface LocatedFile {
  id: number
  url: string
  [key: string]: unknown
}

interface UploadProvider {
  isPrivate?: () => boolean | Promise<boolean>
  getSignedUrl?: (file: LocatedFile) => Promise<{ url: string }>
}

/**
 * Opens the original bytes of a stored file.
 *
 * @remarks
 * A relative URL is a file of the local provider, under the host's public folder. Any other URL is
 * fetched, signed first when the provider keeps its files private.
 *
 * @throws `ExportError` `exportMediaUnreadable` when the file cannot be read.
 */
export async function openFile(
  strapi: Core.Strapi,
  file: LocatedFile
): Promise<AsyncIterable<Buffer>> {
  if (file.url.startsWith('/')) {
    const root = path.resolve(strapi.dirs.static.public)
    const location = path.resolve(root, `.${decodeURI(file.url)}`)
    if (!location.startsWith(`${root}${path.sep}`))
      throw unreadable(file, 'outside the public folder')
    return createReadStream(location)
  }
  const provider = strapi.plugin('upload').provider as UploadProvider
  const url = (await provider.isPrivate?.()) ? (await provider.getSignedUrl!(file)).url : file.url
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw unreadable(file, error instanceof Error ? error.message : 'the request failed')
  }
  if (!response.ok || !response.body) throw unreadable(file, `answered ${response.status}`)
  return Readable.fromWeb(response.body as never)
}

/** The SHA-256 and the size of a stored file. */
export async function digestFile(
  strapi: Core.Strapi,
  file: LocatedFile
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256')
  let bytes = 0
  try {
    for await (const chunk of await openFile(strapi, file)) {
      hash.update(chunk)
      bytes += chunk.length
    }
  } catch (error) {
    if (error instanceof ExportError) throw error
    throw unreadable(file, error instanceof Error ? error.message : 'the read failed')
  }
  return { sha256: hash.digest('hex'), bytes }
}

// The URL stays out of the message: a signed URL is a credential.
function unreadable(file: LocatedFile, why: string): ExportError {
  return new ExportError('exportMediaUnreadable', `Media file ${file.id} cannot be read: ${why}`)
}
