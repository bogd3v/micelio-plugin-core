# Block catalogue

The blocks a page is made of, as a contract ([ADR-0018](https://github.com/bogd3v/micelio/blob/main/docs/adr/0018-blocks-as-a-contract.md)): each block has a stable `id`, the `schema` of the Strapi component that stores its content, its presentation `options`, its `cost` and its `static` alternative, and optionally the `module` of `site.modules` it needs. The catalogue is the builder's palette and the theme creator's reference.

The first catalogue is the 19 blocks of ADR-0018, section 6, read from `micelio-cms` `v0.4.0`. It changes no block's content: the components stay in `micelio-cms` until the cut-over of release line 0.7. The presentation options of the vocabulary ([below](#presentation-options)) are the one addition.

## Where it lives

| File                          | What it is                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `contract/blocks.ts`          | The catalogue, the source of truth. Its fields are written with the builders of `contract/fields.ts` (zod)            |
| `contract/options.ts`         | The presentation options vocabulary: the eight names and their values                                                 |
| `contract/blocks.schema.json` | Generated: the JSON Schema of each block's content as the content API answers it, published as `./blocks.schema.json` |
| `docs/blocks.md`              | This file. The reference below the marker is generated; the rest is written by hand                                   |
| `GET /micelio/blocks`         | The catalogue for the admin panel, with each block's JSON Schema ([`docs/api.md`](api.md))                            |

```bash
npm run blocks:generate   # rewrite contract/blocks.schema.json and the reference below
npm run lint:blocks       # fail when either drifts from contract/blocks.ts (part of npm run lint)
```

When an instance boots with a catalogue that differs from the one it last booted with, the plugin runs the `blockCatalogueChanged` hook with the ids of the blocks added, changed and removed ([`docs/hooks.md`](hooks.md)); a fresh instance announces every block as added.

A change to the catalogue follows ADR-0018, section 2: a new block, option, option value or optional field is a MINOR; removing or renaming one, or a new required field without a content migration, is a MAJOR (before 1.0.0, a `0.y`).

## Presentation options

A block's `options` are a closed set of presentation values (ADR-0018, section 1). `variant` is the block's own set. The rest come from one vocabulary, `contract/options.ts`: eight names with short value sets, each with a default (in bold below) that keeps today's content valid. A block declares which names it exposes (the reference below lists them per block) and offers all of a name's values, less the two withheld below. The vocabulary is the only place a value is written; a theme styles each value and may restyle it, and how it does so is in `docs/themes/` of `micelio`.

| Option    | Values, in the artboard's order (default in bold) | Exposed by                                                                  |
| --------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| `layout`  | **`centered`**, `split`, `stacked`                | `hero`, `cta`, `testimonials`                                               |
| `width`   | **`prose`**, `wide`, `full`                       | `rich-text`, `gallery`, `media`, `quote`                                    |
| `columns` | `2`, **`3`**, `4`, `6`                            | `feature-grid`, `stats`, `pricing`, `logo-cloud`                            |
| `density` | **`comfortable`**, `compact`                      | `feature-grid`, `gallery`, `logo-cloud`, `testimonials`, `faq`, `post-list` |
| `align`   | **`start`**, `center` (there is no `end`)         | `quote` and the fourteen page sections                                      |
| `tone`    | **`default`**, `raised`, `accent`                 | the fourteen page sections                                                  |
| `ratio`   | **`16:9`**, `4:3`, `1:1`, `auto`                  | `media`, `slider`, `media-showcase`                                         |
| `height`  | `s`, **`m`**, `l`, `full`                         | `hero`, `scene`, `playground`                                               |

`tone` and `align` are on the fourteen page sections (`page.sections`). A `scene` offers them only in its `inline` variant: its `background` variant paints its own poster, and a save that sets either on it (a `scene` with no `variant` takes `background`) is refused with `blockOptionInvalid` unless the value is the option's default, the only value allowed (the content API stores both on a `scene`). The builder leaves both out of a new `background` scene, so a site's default of either never reaches it.

Two values are withheld: `width: full` from the article blocks (`media`, `quote`) and `columns: 6` from every block but `logo-cloud`; the reference lists the values each block offers.

Each is stored in the block's component as an optional Strapi `enumeration` with its default, so content saved before the option existed stays valid and renders as the default. The default is the value the block renders today, so content saved before keeps its look. Values are strings: `columns: 3` and `columns: "3"` are the same value, and a number outside the set is refused.

**Validation at save.** On `create`, `update` and `clone` (the Content Manager's duplicate) of any type with a dynamic zone, the plugin checks every option in the blocks the data names and refuses the save with `blockOptionInvalid` ([`docs/api.md`](api.md#errors)) when a block does not expose the option or the value is not one the block offers: the problem detail names the block, the option and the allowed values. An absent or `null` option takes its default. Stored content is not re-checked, and a component that is not a block of the catalogue is left alone. The components must declare the attributes (the host's, or `micelio-cms`'s once it adds them: the components of `v0.4.0` store only `variant`), or Strapi refuses the unknown key first.

**What a site manages.** The catalogue is the core's and read only; a site manages a layer on top
of it (the Block catalogue page, [`docs/operate/block-catalogue.md`](operate/block-catalogue.md)):
whether a block is enabled, the page types it is allowed in, the options a new block starts with
and its label in the palette. A default is checked against this file's values when it is saved and
is refused with `blockOptionInvalid` if the block does not offer it, so a site cannot make a block
start with something the save would refuse. A stored default that a later release withdraws falls
back to the core's.
The merged view is `GET /micelio/blocks?site=` ([`docs/api.md`](api.md#block-catalogue)).

Adding an option to a block, or a value to an option, changes the block's fingerprint, so `blockCatalogueChanged` runs with the block in `changed` on the next boot.

## Instance ids

Every block has a `blockId` and every repeatable item an `itemId` (ADR-0018, section 1; the catalogue `id` names a kind of block, these name one instance of it). `id` is reserved by Strapi, hence the names. Both are opaque strings (a UUID when the plugin makes one) and optional in the schema, so content saved before them stays valid; `micelio-cms` fills the stored content in a boot migration.

**Generation at save.** On `create`, `update` and `clone` of any type with a dynamic zone, the plugin gives a block of the data that has no `blockId` one that is unique in its zone, and an item that has no `itemId` one that is unique in its parent block. On `update` the ids stored in the draft win over what the save writes: an edit that sends another id at a block's or item's place keeps the stored one, a save that omits them keeps them, and a reorder moves each id with its block. An id that no stored entry holds is kept only when it is unique, so an import or a duplicate restores the ids it carries. A component that does not declare the field is left alone. A page template keeps neither id, so a page made from one gets its own. The builder hides both fields: editors never see them, its duplicate of a block carries neither id, and it takes in the ids a save answers, so a block added in a session keeps its id when it is moved and saved again.

## Modules

A block may declare `module`, one of the keys of the site's `modules` component (`newsletter`,
`comments`, `accounts`, `drafts`, `fediverse`, `search`, `support`); today only `newsletter`
declares one. A site that has the module off is not offered the block (`GET /micelio/blocks?site=`
marks it `offered: false` with the reason `moduleOff`) and a save that adds it is refused with
`blockNotAllowed` naming the module; pages that already hold it keep rendering and saving
([`docs/api.md`](api.md#the-merged-view)). `module` is optional, so adding it to a block is a MINOR
(ADR-0018, section 2). The reference below lists it as **Module** on the blocks that declare it.

## Islands

A block that loads script once it is used declares `cost.island`: its `id` in the heavy island
registry, its `budget`, the `js` it loads, and three more things the editor sees and the engine
checks (the badge of [the builder](guide/builder.md)):

- **`kind`**: `3d`, `runtime`, `media`, `diagram` or `data`, one icon each. Today `scene` is
  `3d` and `playground` is `runtime`; the other kinds are in the vocabulary and no block declares
  them yet.
- **`loadKb`**: what the island loads once it is used, in kB (its script and the runtime's files; a
  model the editor picks is content and not counted). Above 1024 kB (`ON_CLICK_ABOVE_KB`) the island
  loads on a click, below it when it scrolls into view. The frontend applies the rule
  (bogd3v/micelio#735); the catalogue only declares the weight, and the admin names the trigger.
- **`alternative`**: the fields of the block's schema its `static` alternative is made of. A page
  with one of them empty is refused at send to review, publish and republish with
  `islandAlternativeMissing` ([`docs/api.md`](api.md#errors)): the visitor of a static build and a
  feed gets that alternative.

A page holds one `scene` with `variant: background`: a second one is refused
at save with `sceneBackgroundLimit` ([`docs/api.md`](api.md#errors)).

Pages saved before this release may hold what these rules refuse; they are not changed, and the
first move out of `draft` of one that lacks an alternative is refused until the editor fills it.

## How a schema maps to Strapi

Each block's JSON Schema describes its content as the content API answers it, its options included (it is an option, and ADR-0018 keeps it stored inside the component until a migration moves it). An optional field may be absent or `null`; a field Strapi requires is in `required`. What JSON Schema cannot say about the Strapi attribute is in the `x-strapi` keyword of the field:

| `x-strapi.type`                                | JSON Schema                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `string`, `text`                               | `string`, with `pattern`, `minLength` and `maxLength`            |
| `richtext`                                     | `string` with `contentMediaType: text/markdown`                  |
| `integer`, `boolean`                           | `integer` with `minimum` and `maximum`, `boolean`                |
| `enumeration`                                  | `string` with `enum`                                             |
| `media`, with `multiple` and `allowedTypes`    | An uploaded file (`url`, `mime` and more), or a list of them     |
| `relation`, with `relation` and `target`       | An entry with its `documentId`                                   |
| `component`, with `component` and `repeatable` | The part's object, or a list of them with `minItems`, `maxItems` |

`default` is Strapi's default, filled in when an entry is created. `test/blocks.test.ts` reads every schema back as Strapi attributes (`contract/strapi.ts`) and compares them, less the options of the vocabulary that `v0.4.0` does not store yet, with the component JSON of `micelio-cms` in `test/fixtures/micelio-cms-components-with-ids.json`: the components of `v0.4.0` plus the `blockId` and `itemId` attributes as `micelio-cms` stores them since #477 (its `source` names the commit and the tag it derives from). That fixture is test data, never registered as a component; a catalogue update regenerates it from the new tag in the same pull request:

```bash
node test/fixtures/micelio-cms-components.mjs <micelio-cms checkout> <tag>
```

## Known limitations

- **`newsletter` in dynamic mode.** The form submits only once the page is hydrated, so it needs JavaScript there. Static and landing builds render the static form (`MycNewsletterStatic`), which works with no JavaScript. Closing the gap is a change to the frontend, out of the scope of the catalogue.

## How cost is measured

`cost` follows ADR-0018, section 1: the gzip bytes of the block's CSS and JS on a page, and, for an island, the JS it loads once used. HTML bytes are not part of it. It was measured on `micelio` `v0.4.0` (`ef5c979`), the frontend of release line 0.4 that pairs with `micelio-cms` `v0.4.0`, in the `bogota` and `starter` themes; the catalogue declares the larger of the two.

- **JS** is the minified code that the client source maps attribute to the block's component and to the components and helpers only blocks use (`SectionHead`, `SectionLink`, `SectionMedia`, the newsletter form, the figure credit), gzipped on its own. What every page loads anyway is not counted: `SectionRenderer` and `BlocksRenderer`, the button, `useStrapi`, the post card of the blog.
- **CSS** is every rule of the built CSS whose selector names the block (`[data-section=<id>]` and the block's own classes, `scripts/blocks/cost.mjs` lists them) in the core's stylesheets and the theme's, gzipped together. A rule that names two blocks counts for both; the rules every section shares (`.myc-section`, `.myc-section-head`, the item grid) are not counted.
- **An island** takes its bytes from its budget in `scripts/perf/budgets.json` of `micelio`: `scriptGzKb` as `scripts/perf/measure.mjs` measures it in dynamic mode, the same in both themes. `scene` (budget `scene`) loads 151.27 KB of JS in 2 requests; `playground` (budget `playground`, the SQL runtime) loads 66.06 KB of JS and 340.64 KB of WebAssembly in 4 requests. Its other runtimes have their own budgets: `playground:python` 266.48 KB of JS and 2,676.82 KB of WebAssembly, `playground:javascript` 18.75 KB and 194.35 KB.

The commands, from a checkout of `micelio` at `v0.4.0` (Node 22 or later), once per theme:

```bash
npm ci
echo 'sourcemap.client=true' >> .nuxtrc  # client source maps; the output is otherwise the same
NUXT_PUBLIC_THEME=bogota npx nuxt build
NUXT_PUBLIC_THEME=bogota node scripts/perf/measure.mjs --serve --pages , --theme bogota --out islands-bogota.json
cp -r .output/public ../build-bogota      # then the same with starter
```

`--pages ,` measures no page, only the heavy islands. Then, from this repository:

```bash
node scripts/blocks/cost.mjs --build bogota=../build-bogota --build starter=../build-starter \
  --islands bogota=islands-bogota.json --islands starter=islands-starter.json
```

The measurement of 2026-10-23, in gzip bytes:

| Block            | CSS, `bogota` | CSS, `starter` | JS, `bogota` | JS, `starter` |
| ---------------- | ------------- | -------------- | ------------ | ------------- |
| `hero`           | 737           | 580            | 1546         | 1556          |
| `feature-grid`   | 643           | 405            | 1344         | 1350          |
| `media-showcase` | 214           | 214            | 1404         | 1423          |
| `stats`          | 527           | 340            | 540          | 540           |
| `logo-cloud`     | 497           | 452            | 1446         | 1446          |
| `testimonials`   | 599           | 397            | 1474         | 1482          |
| `pricing`        | 805           | 590            | 1181         | 1186          |
| `faq`            | 527           | 367            | 525          | 525           |
| `cta`            | 483           | 254            | 798          | 803           |
| `post-list`      | 376           | 233            | 768          | 768           |
| `newsletter`     | 763           | 735            | 1810         | 1822          |
| `rich-text`      | 1940          | 1895           | 225          | 226           |
| `gallery`        | 425           | 220            | 1242         | 1251          |
| `scene`          | 601           | 434            | 1299         | 1303          |
| `prose`          | 1895          | 1895           | 610          | 609           |
| `quote`          | 293           | 293            | 258          | 259           |
| `media`          | 543           | 543            | 1395         | 1400          |
| `slider`         | 1545          | 1545           | 2601         | 2615          |
| `playground`     | 633           | 633            | 1757         | 1758          |

`rich-text` and `prose` carry the Markdown styles (`.myc-prose`, code blocks, callouts), which an article page loads anyway. A higher declared cost is a PATCH with the reason and the numbers (ADR-0018, section 2).

<!-- blocks:reference:start (npm run blocks:generate) -->

## Blocks

| id               | Component                | `variant` (default first)         | Other options                         | CSS (B gzip) | JS (B gzip) | Island                 |
| ---------------- | ------------------------ | --------------------------------- | ------------------------------------- | ------------ | ----------- | ---------------------- |
| `hero`           | `section.hero`           | `centered`, `split`, `full-bleed` | `layout`, `align`, `tone`, `height`   | 737          | 1556        | No                     |
| `feature-grid`   | `section.feature-grid`   | `grid`, `list`, `bento`           | `columns`, `density`, `align`, `tone` | 643          | 1350        | No                     |
| `media-showcase` | `section.media-showcase` | `left`, `right`, `stacked`        | `align`, `tone`, `ratio`              | 214          | 1423        | No                     |
| `stats`          | `section.stats`          | `row`, `cards`                    | `columns`, `align`, `tone`            | 527          | 540         | No                     |
| `logo-cloud`     | `section.logo-cloud`     | `row`, `marquee`                  | `columns`, `density`, `align`, `tone` | 497          | 1446        | No                     |
| `testimonials`   | `section.testimonials`   | `single`, `grid`                  | `layout`, `density`, `align`, `tone`  | 599          | 1482        | No                     |
| `pricing`        | `section.pricing`        | `cards`, `table`                  | `columns`, `align`, `tone`            | 805          | 1186        | No                     |
| `faq`            | `section.faq`            | `list`, `two-columns`             | `density`, `align`, `tone`            | 527          | 525         | No                     |
| `cta`            | `section.cta`            | `banner`, `card`                  | `layout`, `align`, `tone`             | 483          | 803         | No                     |
| `post-list`      | `section.post-list`      | `cards`, `list`                   | `density`, `align`, `tone`            | 376          | 768         | No                     |
| `newsletter`     | `section.newsletter`     | `inline`, `card`                  | `align`, `tone`                       | 763          | 1822        | No                     |
| `rich-text`      | `section.rich-text`      |                                   | `width`, `align`, `tone`              | 1940         | 226         | No                     |
| `gallery`        | `section.gallery`        | `grid`, `masonry`                 | `width`, `density`, `align`, `tone`   | 425          | 1251        | No                     |
| `scene`          | `section.scene`          | `background`, `inline`            | `align`, `tone`, `height`             | 601          | 1303        | `scene` (3d)           |
| `prose`          | `shared.rich-text`       |                                   |                                       | 1895         | 610         | No                     |
| `quote`          | `shared.quote`           |                                   | `width`, `align`                      | 293          | 259         | No                     |
| `media`          | `shared.media`           |                                   | `width`, `ratio`                      | 543          | 1400        | No                     |
| `slider`         | `shared.slider`          |                                   | `ratio`                               | 1545         | 2615        | No                     |
| `playground`     | `shared.playground`      |                                   | `height`                              | 633          | 1758        | `playground` (runtime) |

### `hero`

- **Component:** `section.hero` (page sections)
- **Options:**
  - `variant`: `centered`, `split`, `full-bleed`; default `centered`
  - `layout`: `centered`, `split`, `stacked`; default `centered`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
  - `height`: `s`, `m`, `l`, `full`; default `m`
- **Cost:** 737 B of CSS and 1556 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript.

| Field           | Type                   | Required | Details |
| --------------- | ---------------------- | -------- | ------- |
| `blockId`       | string                 | No       |         |
| `title`         | string                 | Yes      |         |
| `text`          | text                   | No       |         |
| `primaryLink`   | `section.link`         | No       |         |
| `secondaryLink` | `section.link`         | No       |         |
| `media`         | media (images, videos) | No       |         |

### `feature-grid`

- **Component:** `section.feature-grid` (page sections)
- **Options:**
  - `variant`: `grid`, `list`, `bento`; default `grid`
  - `columns`: `2`, `3`, `4`; default `3`
  - `density`: `comfortable`, `compact`; default `comfortable`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 643 B of CSS and 1350 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript.

| Field     | Type                               | Required | Details               |
| --------- | ---------------------------------- | -------- | --------------------- |
| `blockId` | string                             | No       |                       |
| `title`   | string                             | No       |                       |
| `text`    | text                               | No       |                       |
| `items`   | `section.feature-item`, repeatable | No       | at least 3; at most 6 |

### `media-showcase`

- **Component:** `section.media-showcase` (page sections)
- **Options:**
  - `variant`: `left`, `right`, `stacked`; default `left`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
  - `ratio`: `16:9`, `4:3`, `1:1`, `auto`; default `16:9`
- **Cost:** 214 B of CSS and 1423 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript, and a video shows its native controls.

| Field     | Type                   | Required | Details |
| --------- | ---------------------- | -------- | ------- |
| `blockId` | string                 | No       |         |
| `title`   | string                 | No       |         |
| `text`    | richtext               | No       |         |
| `media`   | media (images, videos) | Yes      |         |
| `link`    | `section.link`         | No       |         |

### `stats`

- **Component:** `section.stats` (page sections)
- **Options:**
  - `variant`: `row`, `cards`; default `row`
  - `columns`: `2`, `3`, `4`; default `3`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 527 B of CSS and 540 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript.

| Field     | Type                       | Required | Details               |
| --------- | -------------------------- | -------- | --------------------- |
| `blockId` | string                     | No       |                       |
| `title`   | string                     | No       |                       |
| `items`   | `section.stat`, repeatable | No       | at least 2; at most 4 |

### `logo-cloud`

- **Component:** `section.logo-cloud` (page sections)
- **Options:**
  - `variant`: `row`, `marquee`; default `row`
  - `columns`: `2`, `3`, `4`, `6`; default `3`
  - `density`: `comfortable`, `compact`; default `comfortable`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 497 B of CSS and 1446 B of JS, gzip
- **Static:** Itself: the marquee is CSS only, and it stops under reduced motion and when a logo is a link.

| Field     | Type                       | Required | Details    |
| --------- | -------------------------- | -------- | ---------- |
| `blockId` | string                     | No       |            |
| `title`   | string                     | No       |            |
| `logos`   | `section.logo`, repeatable | No       | at least 1 |

### `testimonials`

- **Component:** `section.testimonials` (page sections)
- **Options:**
  - `variant`: `single`, `grid`; default `single`
  - `layout`: `centered`, `split`, `stacked`; default `centered`
  - `density`: `comfortable`, `compact`; default `comfortable`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 599 B of CSS and 1482 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript.

| Field     | Type                              | Required | Details    |
| --------- | --------------------------------- | -------- | ---------- |
| `blockId` | string                            | No       |            |
| `title`   | string                            | No       |            |
| `items`   | `section.testimonial`, repeatable | No       | at least 1 |

### `pricing`

- **Component:** `section.pricing` (page sections)
- **Options:**
  - `variant`: `cards`, `table`; default `cards`
  - `columns`: `2`, `3`, `4`; default `3`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 805 B of CSS and 1186 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript.

| Field     | Type                       | Required | Details    |
| --------- | -------------------------- | -------- | ---------- |
| `blockId` | string                     | No       |            |
| `title`   | string                     | No       |            |
| `text`    | text                       | No       |            |
| `plans`   | `section.plan`, repeatable | No       | at least 1 |

### `faq`

- **Component:** `section.faq` (page sections)
- **Options:**
  - `variant`: `list`, `two-columns`; default `list`
  - `density`: `comfortable`, `compact`; default `comfortable`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 527 B of CSS and 525 B of JS, gzip
- **Static:** Itself: the answers open and close with the native `<details>` element.

| Field     | Type                           | Required | Details    |
| --------- | ------------------------------ | -------- | ---------- |
| `blockId` | string                         | No       |            |
| `title`   | string                         | No       |            |
| `items`   | `section.faq-item`, repeatable | No       | at least 1 |

### `cta`

- **Component:** `section.cta` (page sections)
- **Options:**
  - `variant`: `banner`, `card`; default `banner`
  - `layout`: `centered`, `split`, `stacked`; default `centered`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 483 B of CSS and 803 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript.

| Field           | Type           | Required | Details |
| --------------- | -------------- | -------- | ------- |
| `blockId`       | string         | No       |         |
| `title`         | string         | Yes      |         |
| `text`          | text           | No       |         |
| `primaryLink`   | `section.link` | No       |         |
| `secondaryLink` | `section.link` | No       |         |

### `post-list`

- **Component:** `section.post-list` (page sections)
- **Options:**
  - `variant`: `cards`, `list`; default `cards`
  - `density`: `comfortable`, `compact`; default `comfortable`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 376 B of CSS and 768 B of JS, gzip
- **Static:** Itself: the posts are rendered with the page.

| Field      | Type                                 | Required | Details                             |
| ---------- | ------------------------------------ | -------- | ----------------------------------- |
| `blockId`  | string                               | No       |                                     |
| `title`    | string                               | No       |                                     |
| `category` | relation to `api::category.category` | No       |                                     |
| `tag`      | relation to `api::tag.tag`           | No       |                                     |
| `count`    | integer                              | Yes      | at least 1; at most 12; default `3` |

### `newsletter`

- **Component:** `section.newsletter` (page sections)
- **Options:**
  - `variant`: `inline`, `card`; default `inline`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 763 B of CSS and 1822 B of JS, gzip
- **Module:** `newsletter`; not offered on a site that has it off in `site.modules`
- **Static:** In static builds, the static form (`MycNewsletterStatic`). In dynamic mode the form submits only once hydrated (a known limitation, `docs/blocks.md`). Nothing when the `newsletter` module is off.

| Field         | Type   | Required | Details |
| ------------- | ------ | -------- | ------- |
| `blockId`     | string | No       |         |
| `title`       | string | No       |         |
| `text`        | text   | No       |         |
| `buttonLabel` | string | No       |         |

### `rich-text`

- **Component:** `section.rich-text` (page sections)
- **Options:**
  - `width`: `prose`, `wide`, `full`; default `prose`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 1940 B of CSS and 226 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript.

| Field     | Type     | Required | Details |
| --------- | -------- | -------- | ------- |
| `blockId` | string   | No       |         |
| `body`    | richtext | Yes      |         |

### `gallery`

- **Component:** `section.gallery` (page sections)
- **Options:**
  - `variant`: `grid`, `masonry`; default `grid`
  - `width`: `prose`, `wide`, `full`; default `prose`
  - `density`: `comfortable`, `compact`; default `comfortable`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 425 B of CSS and 1251 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript.

| Field     | Type                    | Required | Details |
| --------- | ----------------------- | -------- | ------- |
| `blockId` | string                  | No       |         |
| `title`   | string                  | No       |         |
| `images`  | media, several (images) | Yes      |         |

### `scene`

- **Component:** `section.scene` (page sections)
- **Options:**
  - `variant`: `background`, `inline`; default `background`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
  - `height`: `s`, `m`, `l`, `full`; default `m`
- **Cost:** 601 B of CSS and 1303 B of JS, gzip; the `scene` island (budget `scene`) loads 154900 B of JS, gzip, once used
- **Island:** `3d`; loads 151.3 kB once used, when it scrolls into view
- **Static alternative needs:** `poster`, `alt`, filled in before the page is sent to review
- **Static:** The required poster, with the alt text of the scene.

| Field     | Type           | Required | Details |
| --------- | -------------- | -------- | ------- |
| `blockId` | string         | No       |         |
| `model`   | media (files)  | Yes      |         |
| `poster`  | media (images) | Yes      |         |
| `alt`     | string         | Yes      |         |
| `title`   | string         | No       |         |
| `text`    | text           | No       |         |

### `prose`

- **Component:** `shared.rich-text` (article and About blocks)
- **Options:** none
- **Cost:** 1895 B of CSS and 610 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript. A Mermaid diagram inside it is the `mermaid` island, and shows its source until it loads.

| Field     | Type     | Required | Details |
| --------- | -------- | -------- | ------- |
| `blockId` | string   | No       |         |
| `body`    | richtext | No       |         |

### `quote`

- **Component:** `shared.quote` (article and About blocks)
- **Options:**
  - `width`: `prose`, `wide`; default `prose`
  - `align`: `start`, `center`; default `start`
- **Cost:** 293 B of CSS and 259 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript.

| Field     | Type   | Required | Details |
| --------- | ------ | -------- | ------- |
| `blockId` | string | No       |         |
| `title`   | string | No       |         |
| `body`    | text   | No       |         |

### `media`

- **Component:** `shared.media` (article and About blocks)
- **Options:**
  - `width`: `prose`, `wide`; default `prose`
  - `ratio`: `16:9`, `4:3`, `1:1`, `auto`; default `16:9`
- **Cost:** 543 B of CSS and 1400 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript.

| Field     | Type                          | Required | Details |
| --------- | ----------------------------- | -------- | ------- |
| `blockId` | string                        | No       |         |
| `file`    | media (images, files, videos) | No       |         |
| `caption` | text                          | No       |         |
| `credit`  | `shared.image-credit`         | No       |         |

### `slider`

- **Component:** `shared.slider` (article and About blocks)
- **Options:**
  - `ratio`: `16:9`, `4:3`, `1:1`, `auto`; default `16:9`
- **Cost:** 1545 B of CSS and 2615 B of JS, gzip
- **Static:** The first slide, with its caption and credit; the controls work once hydrated.

| Field     | Type                       | Required | Details |
| --------- | -------------------------- | -------- | ------- |
| `blockId` | string                     | No       |         |
| `items`   | `shared.slide`, repeatable | No       |         |
| `files`   | media, several (images)    | No       |         |

### `playground`

- **Component:** `shared.playground` (article and About blocks)
- **Options:**
  - `height`: `s`, `m`, `l`, `full`; default `m`
- **Cost:** 633 B of CSS and 1758 B of JS, gzip; the `playground` island (budget `playground`) loads 67645 B of JS, gzip, once used
- **Island:** `runtime`; loads 406.7 kB once used, when it scrolls into view
- **Static alternative needs:** `expectedOutput`, filled in before the page is sent to review
- **Static:** The highlighted code and its expected output.

| Field            | Type        | Required | Details                       |
| ---------------- | ----------- | -------- | ----------------------------- |
| `blockId`        | string      | No       |                               |
| `runtime`        | enumeration | Yes      | `python`, `sql`, `javascript` |
| `code`           | text        | Yes      | at most 5000 characters       |
| `expectedOutput` | text        | No       | at most 5000 characters       |
| `setup`          | text        | No       | at most 20000 characters      |
| `caption`        | text        | No       |                               |

## Parts

Nested components: each exists only inside the `schema` of the blocks listed with it.

### `section.faq-item`

Nested in `faq`.

| Field      | Type     | Required | Details |
| ---------- | -------- | -------- | ------- |
| `itemId`   | string   | No       |         |
| `question` | string   | Yes      |         |
| `answer`   | richtext | Yes      |         |

### `section.feature-item`

Nested in `feature-grid`.

| Field    | Type           | Required | Details |
| -------- | -------------- | -------- | ------- |
| `itemId` | string         | No       |         |
| `icon`   | media (images) | No       |         |
| `title`  | string         | Yes      |         |
| `text`   | text           | No       |         |

### `section.link`

Nested in `hero`, `media-showcase`, `pricing`, `cta`.

| Field   | Type   | Required | Details                                         |
| ------- | ------ | -------- | ----------------------------------------------- |
| `label` | string | Yes      |                                                 |
| `url`   | string | Yes      | matches `^(https?:\/\/\S+\|mailto:\S+\|\/\S*)$` |

### `section.logo`

Nested in `logo-cloud`.

| Field    | Type           | Required | Details                    |
| -------- | -------------- | -------- | -------------------------- |
| `itemId` | string         | No       |                            |
| `image`  | media (images) | Yes      |                            |
| `name`   | string         | Yes      |                            |
| `url`    | string         | No       | matches `^https?:\/\/\S+$` |

### `section.plan`

Nested in `pricing`.

| Field         | Type           | Required | Details              |
| ------------- | -------------- | -------- | -------------------- |
| `itemId`      | string         | No       |                      |
| `name`        | string         | Yes      |                      |
| `price`       | string         | Yes      |                      |
| `period`      | string         | No       |                      |
| `features`    | text           | No       | One feature per line |
| `link`        | `section.link` | No       |                      |
| `recommended` | boolean        | No       | default `false`      |

### `section.stat`

Nested in `stats`.

| Field    | Type   | Required | Details |
| -------- | ------ | -------- | ------- |
| `itemId` | string | No       |         |
| `value`  | string | Yes      |         |
| `label`  | string | Yes      |         |

### `section.testimonial`

Nested in `testimonials`.

| Field    | Type           | Required | Details |
| -------- | -------------- | -------- | ------- |
| `itemId` | string         | No       |         |
| `quote`  | text           | Yes      |         |
| `author` | string         | Yes      |         |
| `role`   | string         | No       |         |
| `avatar` | media (images) | No       |         |

### `shared.image-credit`

Nested in `media`, `slider`.

| Field           | Type        | Required | Details                                                                                                            |
| --------------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `kind`          | enumeration | Yes      | `photo`, `illustration`, `diagram`, `screenshot`; default `photo`                                                  |
| `author`        | string      | No       |                                                                                                                    |
| `authorUrl`     | string      | No       | matches `^https?:\/\/\S+$`                                                                                         |
| `source`        | string      | No       |                                                                                                                    |
| `sourceUrl`     | string      | No       | matches `^https?:\/\/\S+$`                                                                                         |
| `license`       | enumeration | Yes      | `own-work`, `cc0`, `public-domain`, `cc-by-4.0`, `cc-by-sa-4.0`, `cc-by-nc-4.0`, `unsplash`, `permission`, `other` |
| `licenseUrl`    | string      | No       | matches `^https?:\/\/\S+$`                                                                                         |
| `modifications` | string      | No       |                                                                                                                    |

### `shared.slide`

Nested in `slider`.

| Field     | Type                  | Required | Details |
| --------- | --------------------- | -------- | ------- |
| `itemId`  | string                | No       |         |
| `file`    | media (images)        | Yes      |         |
| `caption` | text                  | No       |         |
| `credit`  | `shared.image-credit` | No       |         |

<!-- blocks:reference:end -->
