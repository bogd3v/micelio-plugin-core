# Reusable blocks

A reusable block is one block, written once and shown on many pages of a site: a call to action or
an announcement that must say the same thing everywhere. A page does not copy it, it references it,
so an edit to the reusable block reaches every page that shows it. A [template](templates.md)
is the other way round: it copies its blocks into a new page, which never changes with it.

Reusable blocks are stored in `plugin::micelio.reusable-block` and edited in the Content Manager,
under **Reusable block**. The builder's own interactions (reuse, detach) come later; the API is in
[api.md](../api.md#reusable-blocks).

## Write one

A reusable block has a **name**, which only editors see and no page renders, and exactly **one
block** of the catalogue, with its options. It belongs to one site, like a page.

The save is refused when:

- It holds more than one block (`reusableBlockInvalid`). An empty draft is kept, but it cannot be
  published until it holds its block.
- Its block is itself a reference to a reusable block: a reference to a reference has no meaning.
- Its block carries a group key. A group is set on the reference in the page, not inside the
  reusable block.

It has an editorial state and goes through review like a page ([review](review.md)). Each locale
has its own version: a page shows the reusable block in its own locale, and nothing where that
locale has none or is not published.

## Use it on a page

A page references it with a block of its zone that points to the reusable block (`reusable` in the
catalogue, with the `section.reusable` component of `micelio-cms`). A page references only its own
site's reusable blocks. A save that points to another site's is refused
(`reusableBlockOtherSite`), and so is moving a page to another site while it references one. A
reference left behind when a reusable block moves to another site renders nothing.

## Publish a change

Publishing a reusable block again, or unpublishing it, changes what every page that references it
shows, at once. Those pages are not edited: they keep their state, their history and their own
publication, and the hooks of a page (the fediverse, a rebuild of that page) do not run for them.

- On a site the frontend renders as it is asked (dynamic), the next view of each page shows the
  change, once its cache revalidates.
- On a static site, the rebuild asks which pages show the reusable block and rebuilds those
  pages, not the whole site.

The plugin lists those pages in its log when you publish, republish or unpublish.

## Delete one

A reusable block that a page still references cannot be deleted. The refusal lists the pages, with
their locale (`reusableBlockInUse`): detach or replace the reference on each, then delete it.

## Move a site

A site's archive carries its reusable blocks before its pages, and an import links each page to the
reusable block it referenced, also when it writes them under new ids. An archive whose page
references a reusable block of another site of the target is refused ([the export
format](../export-format.md#reusable-blocks)).
