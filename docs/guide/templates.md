# Page templates

A template is a saved sequence of blocks with their options. A new page starts from one and
copies it: the page and the template are never linked, so editing the template later changes new
pages only, and deleting it changes none.

Templates belong to a site. One saved for **every site of this CMS** is listed on all of them. A
template is stored in `plugin::micelio.page-template`, which is hidden from the Content Manager and
has no content API route: the dialog, the gallery and the commands below are how it is written.
`GET /micelio/templates` and the other routes are in [the API](../api.md#page-templates).

## Save a page as a template

You need the permission **Manage the page templates of a site**
(`plugin::micelio.templates.manage`, in Settings → Roles). Open **Page settings** in the builder
and press **Save as template…**. The button is disabled while the page has changes that are not
saved yet: the template is made from the saved draft.

The dialog asks for:

- A **name**, unique on the site, and a **description** shown on the template's card.
- The **page type** the template is for.
- For each block, **Keep as sample text** or **Clear**, and **Fixed**. The block and its options
  are always kept. A cleared block keeps its options and the number of its items, empty. Images
  and links are never kept, whatever you choose. **Fixed** is recorded on the template; the
  Template tab that enforces it on a page is not built yet (#55).
- **Available to**: this site only, or every site of the CMS.

The checks show beside it, and the server repeats them when you save:

- The structure alone, before any content, fits the budget of the page type
  (`templateOverBudget` otherwise).
- Every option is one the catalogue offers (`blockOptionInvalid`).
- Every block is enabled, and allowed on the page type, on the site, and for **every site** when
  the template is CMS-wide. The refusal names the site and the block (`templateBlockNotAllowed`).
- The name is not taken on the site (`templateNameTaken`).
- Islands are listed: a page made from the template fills in their static alternative before it
  goes to review ([Islands](../blocks.md)).

The thumbnail is drawn from the structure, one shape for each block, never from the page's images.

## Start a page from a template

A page type made with `withPageSettings` has the **New page from a template…** button in the
header of its create view. It opens **New page**: the templates of the site as cards, and an empty
page. Choose a card, give the page a title if you like and press **Create from <name>**. The page
opens in the builder, and the new page records `templateId` and `templateVersion`.

- The page copies the blocks, their options and the sample text. The sample text is greyed in the
  builder, with a note, until you replace it.
- A page that still holds a sample text cannot be published or scheduled: the transition is
  refused with `sampleTextPresent`, naming the blocks and fields
  ([Errors](../api.md#errors)). Moving it to review is allowed.
- A role needs the permission to create the page type in the Content Manager, with the fields a
  page writes (the blocks, title, slug and page type). It does not need `templates.manage`. To save
  a page as a template, a role needs `templates.manage` and the permission to read that page type.

## Move a template between sites and CMSs

The JSON of a template is the same file in both directions. In the gallery, a role with
`templates.manage` has **Export JSON** on each card and **Import a template** above them. On the
command line, in the Strapi project's folder:

```bash
npx micelio template export <template id or name> [--site <site slug>] [--output <file>]
npx micelio template import <file> --site <site slug> [--scope site|cms]
```

`export` takes the template's id, or its name with `--site`, and writes
`<name>.micelio-template.json` unless `--output` says otherwise. `import` stores the file as the
same template, with the same name, blocks and version, after the checks of a save; a name the site
already uses is refused. A template of a theme is not read.

## Not built yet

- The page of templates, the Template tab of the page settings (usage, offers, switch and detach)
  and the enforcement of **Fixed** on a page: #55.
- Templates a theme ships in its package.
