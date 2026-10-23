import { describe, expect, it } from 'vitest'
import { PROJECT_NAME } from '../src/index.js'

describe('micelio-plugin-core', () => {
  it('exports its name', () => {
    expect(PROJECT_NAME).toBe('micelio-plugin-core')
  })
})
