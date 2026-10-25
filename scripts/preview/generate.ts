// Writes the JSON Schema of the preview messages from `contract/preview.ts` (ADR-0019, section 4).
// With `--check` it writes nothing and fails when the file drifts.
//
//   npm run preview:generate   # write contract/preview.schema.json
//   npm run lint:preview       # the same, as a check
import { readFileSync, writeFileSync } from 'node:fs'
import prettier from 'prettier'
import { previewJsonSchema } from '../../contract/preview'

const SCHEMA_FILE = new URL('../../contract/preview.schema.json', import.meta.url)

const options = await prettier.resolveConfig(SCHEMA_FILE)
const formatted = await prettier.format(JSON.stringify(previewJsonSchema()), {
  ...options,
  parser: 'json',
})
let current = ''
try {
  current = readFileSync(SCHEMA_FILE, 'utf8')
} catch {
  // A missing file is written, or drifted under --check.
}
if (current !== formatted) {
  if (process.argv.includes('--check')) {
    console.error(
      'contract/preview.schema.json drifted from contract/preview.ts: run npm run preview:generate'
    )
    process.exitCode = 1
  } else {
    writeFileSync(SCHEMA_FILE, formatted)
  }
}
