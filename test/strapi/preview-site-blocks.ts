// The part of the stub site that plays phase 2 of the preview protocol (ADR-0019, amendment of
// 2026-11-02, bogd3v/micelio#732): it marks the blocks of the zone, reports their boxes and answers
// `select`, `hover`, `insertGap`, `patch` and `renderMode`. The frontend's own code (`previewBridge.ts` in
// `micelio`) is the real thing; this plays it so the suites run without that image.

/** The catalogue id of a component: its name without the namespace. */
export const blockIdOf = (component: string | undefined): string =>
  (component ?? '').slice((component ?? '').indexOf('.') + 1)

/** The components the stub renders, by catalogue id; others are not rendered, as the frontend skips unknown ones. */
export const RENDERED = new Set(['rich-text', 'scene', 'feature-grid', 'logo-cloud'])

/** Wraps the HTML of each rendered section in the root the frontend marks (`data-myc-block`, `data-myc-index`). */
export function markBlocks(
  sections: { __component?: string }[],
  render: (section: never) => string
): string {
  const known = sections.filter((section) => RENDERED.has(blockIdOf(section.__component)))
  const blocks = known.map(
    (section, index) =>
      `<div data-myc-block="${blockIdOf(section.__component)}" data-myc-index="${index}">${render(section as never)}</div>`
  )
  return `<div data-myc-zone="sections">${blocks.join('\n')}</div>`
}

/** The script of the stub's page: the phase 2 half. */
export function blocksScript(adminOrigin: string, version: string): string {
  return `
const zone = document.querySelector('[data-myc-zone="sections"]')
const version = ${JSON.stringify(version)}
const send = (type, payload) => window.parent.postMessage({ v: 1, type, payload }, ${JSON.stringify(adminOrigin)})
const blocks = () => [...zone.querySelectorAll(':scope > [data-myc-block]')]
const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height } }
const addressOf = (el) => ({ zone: 'sections', index: Number(el.dataset.mycIndex), block: el.dataset.mycBlock, version })
const itemsOf = (el) => [...el.querySelectorAll('.myc-section-item')]
const report = () => send('micelio:blocks', {
  version, scroll: { x: scrollX, y: scrollY }, viewport: { width: innerWidth, height: innerHeight },
  blocks: blocks().map((el) => ({ address: addressOf(el), box: box(el), items: itemsOf(el).map((item, index) => ({ index, box: box(item) })) })),
})
const pointed = (el, item) => ({
  address: el ? addressOf(el) : null, item: el ? item : null,
  box: el ? box(item === null ? el : itemsOf(el)[item] ?? el) : null,
})
const find = (address) => blocks().find((el) => Number(el.dataset.mycIndex) === address.index && el.dataset.mycBlock === address.block)
window.__mycReceived = []
addEventListener('message', (event) => {
  if (event.origin !== ${JSON.stringify(adminOrigin)} || event.source !== window.parent) return
  const m = event.data
  if (!m || m.v !== 1 || typeof m.type !== 'string' || !m.type.startsWith('micelio:')) return
  window.__mycReceived.push(m)
  const p = m.payload
  if (m.type === 'micelio:select' || m.type === 'micelio:hover') {
    if (p.address && p.address.version !== version) return
    const el = p.address ? find(p.address) : undefined
    // The frontend scrolls a selected block into view when the admin asks for it (previewBridge.ts).
    if (m.type === 'micelio:select' && p.reveal && el) el.scrollIntoView({ block: 'nearest' })
    send(m.type === 'micelio:select' ? 'micelio:selected' : 'micelio:hovered', pointed(el, p.item ?? null))
  } else if (m.type === 'micelio:insertGap') {
    if (p.version !== version) return
    zone.querySelectorAll('[data-myc-gap]').forEach((gap) => gap.remove())
    const anchor = p.after === null ? blocks()[0] : blocks().find((el) => Number(el.dataset.mycIndex) === p.after)
    if (p.height > 0 && anchor) {
      const gap = document.createElement('div')
      gap.setAttribute('data-myc-gap', '')
      gap.setAttribute('aria-hidden', 'true')
      gap.style.height = p.height + 'px'
      if (p.after === null) anchor.before(gap); else anchor.after(gap)
    }
    report()
  } else if (m.type === 'micelio:patch') {
    if (p.address.version !== version) return
    const el = find(p.address)
    if (!el) return
    for (const [field, value] of Object.entries(p.content)) {
      const target = el.querySelector('[data-field="' + field + '"]')
      if (target) target.textContent = value ?? ''
    }
    for (const { index, content } of p.items) {
      const item = itemsOf(el)[index]
      for (const [field, value] of Object.entries(content)) {
        const target = item && item.querySelector('[data-field="' + field + '"]')
        if (target) target.textContent = value ?? ''
      }
    }
    report()
  } else if (m.type === 'micelio:renderMode') {
    if (p.address.version !== version) return
    const el = find(p.address)
    // The frontend shows the island or its static alternative (bogd3v/micelio#735); the stub only marks it.
    if (el) el.setAttribute('data-myc-mode', p.mode)
  }
})
document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-myc-block]')
  if (!el || el.parentElement !== zone) return
  event.preventDefault()
  const item = event.target.closest('.myc-section-item')
  send('micelio:selected', pointed(el, item ? itemsOf(el).indexOf(item) : null))
}, true)
document.addEventListener('pointermove', (event) => {
  const el = event.target.closest && event.target.closest('[data-myc-block]')
  send('micelio:hovered', pointed(el && el.parentElement === zone ? el : null, null))
})
addEventListener('scroll', report, { passive: true })
new ResizeObserver(report).observe(zone)
report()
`
}
