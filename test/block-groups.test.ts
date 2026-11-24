import { describe, expect, it } from 'vitest'
import { findGroupViolation } from '../server/src/block-groups/rules'

const member = (groupId: unknown, tone: unknown = 'accent', component = 'section.cta') => ({
  __component: component,
  group: { groupId, tone },
})
const cta = { __component: 'section.cta' }

// The rule of ADR-0022, section 2, as a pure function of the zones of a save.
describe('the groups of a save', () => {
  it('passes a page with no group, one group of one, and consecutive groups', () => {
    expect(findGroupViolation({ sections: [] })).toBeNull()
    expect(findGroupViolation({ sections: [cta, member('a'), cta] })).toBeNull()
    expect(
      findGroupViolation({ sections: [member('a'), member('a'), member('b', 'raised'), cta] })
    ).toBeNull()
  })

  it('makes no member of a key that is null, has no groupId or an empty one', () => {
    const sections = [member('a'), { ...cta, group: null }, member(''), { ...cta, group: {} }, cta]
    expect(findGroupViolation({ sections })).toBeNull()
    // Each of them splits a group it sits in.
    for (const between of [{ ...cta, group: null }, member(''), { ...cta, group: {} }]) {
      expect(findGroupViolation({ sections: [member('a'), between, member('a')] })).toMatchObject({
        reason: 'split',
        position: 2,
        member: { position: 0 },
        between: { position: 1, block: 'cta' },
      })
    }
  })

  it("splits a group with a host's own component, named by its UID", () => {
    expect(
      findGroupViolation({ sections: [member('a'), { __component: 'fixture.panel' }, member('a')] })
    ).toMatchObject({ reason: 'split', between: { position: 1, block: 'fixture.panel' } })
  })

  it('takes a groupId in two zones as two runs, with no block between', () => {
    const violation = findGroupViolation({ sections: [member('a')], blocks: [member('a')] })
    expect(violation).toMatchObject({
      reason: 'split',
      zone: 'blocks',
      position: 0,
      member: { zone: 'sections', position: 0 },
    })
    expect(violation?.between).toBeUndefined()
  })

  it('compares the tone of the group key, an absent one included, and never the tone option', () => {
    expect(
      findGroupViolation({
        sections: [member('a', 'raised'), { ...cta, group: { groupId: 'a' } }],
      })
    ).toMatchObject({ reason: 'tone', groupTone: 'raised', tone: null })
    expect(
      findGroupViolation({
        sections: [
          { ...member('a', 'raised'), tone: 'accent' },
          { ...member('a', 'raised'), tone: 'default' },
        ],
      })
    ).toBeNull()
  })
})
