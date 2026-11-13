# The Block catalogue page

**Kind:** how-to. The blocks a page is made of are defined by the core (`contract/blocks.ts`,
[blocks.md](../blocks.md)) and are the same on every site. What a site decides about them is managed
in **Micelio → Block catalogue**, in the admin at `/admin/plugins/micelio/blocks`.

## Who sees it, who changes it

| Permission                      | Lets a role                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `plugin::micelio.blocks.read`   | Open the page, read a site's settings and the pages that use each block            |
| `plugin::micelio.blocks.manage` | Also change them: the switch, the drawer's **Save** and **Reset to core defaults** |

Both are in Settings → Roles → Plugins → Micelio, and the super admin has them. The page is for
whoever owns the catalogues: **manage** decides what every editor of a site may insert, so it is
not part of an editor's role. Both permissions are global, as Strapi's roles are (ADR-0017): they
cover every site, and a role cannot be limited to one. A role with **read** only sees the switches and the drawer
disabled and no **Save**. The palette of the builder needs neither: every admin user reads the
merged view.

**Measure again** also needs the permissions that preview a page: **Preview drafts on the frontend**
and read access to the page's type (the same ones the cost panel of the edit view asks for).

## What a site can set

Pick the site in the **Site** select; every setting is for that site alone.

- **On** is the switch of the row. A disabled block is hidden from the palette of the site and
  cannot be added to a page: the API answers `blockNotAllowed`. **Pages that already use it keep
  rendering** and can still be saved; only adding another is refused.
- A block that needs a **module** the site has off (today `newsletter`, which needs the
  `newsletter` module of the site's Modules) shows its switch disabled and the sentence "Not
  offered: the newsletter module is off on <site>". It is not in the palette and the API answers
  `blockNotAllowed`; turn the module on in **Content Manager → Site**, Modules, to offer it. Pages that already use it keep
  rendering and saving.
- **Page types where it is allowed** (`landing`, `standard`, `long-read`, and any page type the
  budgets define for the site). Unticking one stops the block being added to pages of that type.
  The core allows every page type; ticking them all stores nothing, so a page type added later is
  allowed too.
- **Default options on this site** are what a new block of the site starts with. Only values the
  block offers are listed, and a default outside them is refused (`blockOptionInvalid`). The values
  themselves are the contract's: nothing here changes what a block can be.
- **Label in the palette**, in English and Spanish, at most 60 characters. Empty shows the block's
  own name.
- **Reset to core defaults** removes the page types, defaults and labels the site set; it keeps
  the switch where it is.

## Cost and where a block is used

The table shows the **declared** cost of each block, in kB (gzip, CSS and JS; an island's script
loads on demand and is apart): the number in the contract.

**Measure again** in the drawer asks the frontend what the block weighs now. It does so only when
pressed: opening the page or the drawer asks the frontend for nothing. It takes the first page of
the site that holds the block and is of a type the CMS measures against a budget, asks for the
editor's own preview grant, loads that page in a frame that is never shown, reads the frontend's
weight report of the draft (`GET <site url>/api/preview/<uid>/<documentId>/weight?mode=dynamic`,
with the grant in a cookie of the frame; see [budgets.md](budgets.md)) and drops the frame. The
only thing sent to the CMS is that report, to `POST /micelio/budget/measure`. The page is the
editor's own draft, so nothing is written. The result is the report's weight for that block on that
page, next to the declared cost: within 0.5 kB it reads "within tolerance", else by how much it is
over or under. The report's weight counts the block's HTML too, which the declared cost leaves out,
so a block with a lot of content reads over.

**Used in** counts the pages of the site, one per document, that hold the block in their saved
draft, wherever it sits in the page, nested in a component included. The count reads the database
when the page opens; it never renders anything.

The drawer lists those pages with a link to the Content Manager and their state, but only the ones
you may read there: a page of a type or a locale your role cannot read is counted and not listed,
so the list can be shorter than the count (or empty, for a role that has only the catalogue's
permission).

## Export and import

The settings are the site's configuration, not its content: an archive of the site does not carry
them ([export-format.md](../export-format.md)). Importing an archive into a site whose catalogue
disables a block that the archive's pages use is refused in the dry run, with the block named.
