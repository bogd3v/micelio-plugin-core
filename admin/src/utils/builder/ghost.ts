/**
 * Sets the drag image of a palette row to the compact card of the Palette states artboard: white,
 * with a primary border and a soft shadow, the icon, the name and the cost.
 *
 * @remarks
 * The card follows the pointer one to one. It is never rotated and its shadow never grows (the
 * Motion artboard, "Drag"; the maintainer's decision on bogd3v/micelio-plugin-core#49).
 */
export function setGhost(
  transfer: DataTransfer,
  name: string,
  cost: string,
  colors: { card: string; text: string; muted: string; accent: string; tint: string }
): void {
  const card = document.createElement('div')
  card.setAttribute('aria-hidden', 'true')
  card.style.cssText =
    'position:fixed;top:-200px;left:-200px;display:flex;align-items:center;gap:8px;padding:8px 12px;' +
    `background:${colors.card};border:1px solid ${colors.accent};border-radius:4px;` +
    'box-shadow:0 4px 12px rgba(33,33,52,.2);' +
    `font:13px sans-serif;color:${colors.text}`
  const icon = document.createElement('span')
  icon.style.cssText = `width:22px;height:22px;border-radius:4px;background:${colors.tint};border:1px solid ${colors.accent}`
  const label = document.createElement('span')
  label.textContent = name
  const price = document.createElement('span')
  price.textContent = cost
  price.style.cssText = `font-size:11px;color:${colors.muted}`
  card.append(icon, label, price)
  document.body.append(card)
  transfer.setDragImage(card, 12, 12)
  // The browser has copied the image by the next task.
  window.setTimeout(() => card.remove(), 0)
}
