# Block catalogue

The blocks a page is made of, as a contract ([ADR-0018](https://github.com/bogd3v/micelio/blob/main/docs/adr/0018-blocks-as-a-contract.md)): each block has a stable `id`, the `schema` of the Strapi component that stores its content, its presentation `options`, its `cost` and its `static` alternative, and optionally the `module` of `site.modules` it needs. The catalogue is the builder's palette and the theme creator's reference.

The first catalogue was the 19 blocks of ADR-0018, section 6, read from `micelio-cms` `v0.4.0`; it has 20 now: `rich-text` (`section.rich-text`, the page's Markdown section) left it and `prose` (`shared.rich-text`) is the one Markdown block, allowed in a page and in an article ([Prose](#prose), micelio-cms#445), `reusable` (`section.reusable`) references a reusable block ([Reusable](#reusable), ADR-0022), and `code` (`shared.code`) shows code with a file name, highlighted lines and a caption ([Code](#code), micelio-cms#448). It changes no block's content: the components stay in `micelio-cms` until the cut-over of release line 0.7. The presentation options of the vocabulary ([below](#presentation-options)) are the one addition.

## Where it lives

| File                          | What it is                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `contract/blocks.ts`          | The catalogue, the source of truth. Its fields are written with the builders of `contract/fields.ts` (zod)            |
| `contract/options.ts`         | The presentation options vocabulary: the nine names and their values                                                  |
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

A block's `options` are a closed set of presentation values (ADR-0018, section 1). `variant` is the block's own set. The rest come from one vocabulary, `contract/options.ts`: nine names with short value sets, each with a default (in bold below) that keeps today's content valid. A block declares which names it exposes (the reference below lists them per block) and offers all of a name's values, less the two withheld below. The vocabulary is the only place a value is written; a theme styles each value and may restyle it, and how it does so is in `docs/themes/` of `micelio`.

| Option      | Values, in the artboard's order (default in bold) | Exposed by                                                                    |
| ----------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `layout`    | **`centered`**, `split`, `stacked`                | `hero`, `cta`, `testimonials`                                                 |
| `width`     | **`prose`**, `wide`, `full`                       | `code`, `gallery`, `media`, `quote`                                           |
| `columns`   | `2`, **`3`**, `4`, `6`                            | `feature-grid`, `stats`, `pricing`, `logo-cloud`, `testimonials`, `post-list` |
| `density`   | **`comfortable`**, `compact`                      | `feature-grid`, `gallery`, `logo-cloud`, `testimonials`, `faq`, `post-list`   |
| `align`     | **`start`**, `center` (there is no `end`)         | `quote` and the thirteen page sections other than `reusable`                  |
| `tone`      | **`default`**, `raised`, `accent`                 | the thirteen page sections other than `reusable`                              |
| `ratio`     | **`16:9`**, `4:3`, `1:1`, `auto`                  | `media`, `slider`, `media-showcase`                                           |
| `height`    | `s`, **`m`**, `l`, `full`                         | `hero`, `scene`, `playground`                                                 |
| `iconStyle` | **`outline`**, `filled`                           | every block with an icon field ([Icons](#icons)); none yet                    |

`tone` and `align` are on the thirteen page sections (`page.sections`) that have options: `reusable` has none of its own ([Reusable](#reusable)). A `scene` offers them only in its `inline` variant: its `background` variant paints its own poster, and a save that sets either on it (a `scene` with no `variant` takes `background`) is refused with `blockOptionInvalid` unless the value is the option's default, the only value allowed (the content API stores both on a `scene`). The builder leaves both out of a new `background` scene, so a site's default of either never reaches it.

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

## Eyebrow and anchor

The twelve sections whose renderer uses `SectionHead` (`hero`, `feature-grid`, `stats`, `logo-cloud`, `testimonials`, `pricing`, `faq`, `cta`, `post-list`, `newsletter`, `gallery`, `scene`) have two optional strings next to `blockId`: `eyebrow`, a short line above the heading, and `anchor`, the id a link or a table of contents points at the section by. The anchor is explicit and never derived from the title, so an edited title breaks no link. Adding them is a MINOR of the contract; a section without them renders as before.

**Validation at save.** On `create`, `update` and `clone` the plugin refuses a save whose `anchor` is not a kebab-case slug (lowercase letters and digits joined by single hyphens), or that an earlier block of the page already uses, with `sectionAnchorInvalid` ([`docs/api.md`](api.md#errors)): the problem detail names the zone and position of the block. An absent, `null` or empty anchor is no anchor. Stored content is not re-checked.

## Newsletter consent

`newsletter` (`section.newsletter`) has three optional fields beside `title`, `text` and `buttonLabel`: `consentText`, the legal sentence a visitor accepts beside a checkbox (Ley 1581, GDPR), and `successMessage` and `placeholder`, the sentence after a subscription and the hint of the address field. There is no default for any of them: a consent text is a node's own wording, and an empty `successMessage` or `placeholder` leaves the frontend's own string. Adding them is a MINOR of the contract; a newsletter without them renders as before.

**Warning at save.** On `create`, `update` and `clone` of any type with a dynamic zone, a `newsletter` block of the data whose `consentText` is absent, `null` or blank gets one line of the server log at `warn`, naming the type, the zone and the position (`[micelio] the newsletter block at api::page.page sections.2 has no consentText; ...`). The save is never refused and the text is never filled in. Stored content is not re-checked.

## FAQ

`faq` (`section.faq`) holds `section.faq-item` entries (`question`, `answer`, and the optional `defaultOpen`). `defaultOpen` is a boolean, `false` by default: a `true` item renders its native `<details>` open. An item stored before the field existed returns `null` until it is saved again, and the frontend reads `null` as closed. Adding it is a MINOR of the contract. `variant` (`list`, `two-columns`), `density`, `align` and `tone` were already in the entry.

## Prose

`prose` (`shared.rich-text`) is the one Markdown block, allowed in a page's zone and in an article's (its `group` is `both`). It replaces `rich-text` (`section.rich-text`), which left the catalogue: the component stays registered in `micelio-cms` for one release, and a page that holds one keeps rendering, but the plugin no longer knows it as a block (it takes no block setting, has no cost line and its body is not checked).

**Heading levels at save.** A page already has its `h1`, so a `prose` body is validated by position: its first heading is an `h2` (a body that opens with an `h1` fails, as one that opens at `h3` or below does), there is no `h1` after it, and a heading is at most one level below the one before it (`h2` to `h4` fails; going back up, `h4` to `h2`, does not). Headings are ATX (`## Title`) or setext (`Title` over `---`) and a heading inside a fenced code block is not one. A body with no heading is sound, and so is an absent, `null` or empty one. On `create`, `update` and `clone` the plugin refuses a save that breaks it with `proseHeadingInvalid` ([`docs/api.md`](api.md#errors)): the problem detail names the zone and position of the block and the heading, with its level and its line in the body. The dry run and the apply of an import check it too. Stored content is not re-checked.

## Groups

Every page section (the blocks whose `group` is `section`, `reusable` included) has an optional `group` key, the part `section.group` with two required fields: `groupId`, an opaque string unique in the page, and `tone`, a value of the `tone` option (`default`, `raised`, `accent`) with no default (ADR-0022, section 2). Consecutive blocks that share a `groupId` form one band on the surface of its `tone`; the sequence stays one flat list, so a block keeps its `blockId` and position (ADR-0019 is unaffected). Groups are one level: a block has one key, so a member is never a group. The article blocks and `prose` take no key. Adding it is a MINOR of the contract; a block without it renders as before.

**Validation at save.** On `create`, `update` and `clone` the plugin refuses with `blockGroupInvalid` ([`docs/api.md`](api.md#errors)) a save where a `groupId` appears in two separate runs (a block of another group, of none, or a host's own component sits between its members, or it is in two zones) or two members of one `groupId` set different `tone`s; the problem detail names the position of the refused block and the earlier member. A key that is absent, `null` or has an empty `groupId` makes no member. A group of one is valid, so removing a block never makes a save fail. A member's own `tone` option is ignored while it is in the group, not refused: it keeps its value. The dry run and the apply of an import check it too. Stored content is not re-checked.

## Code

`code` (`shared.code`) shows code with a file name, highlighted lines and a caption, allowed in a page's zone and in an article's (its `group` is `both`; micelio-cms#448). Every field is optional and none has a default. `language` enumerates the languages the server's highlighter registers (highlight.js, run on the server only): `bash`, `shell`, `javascript`, `typescript`, `json`, `yaml`, `xml`, `css`, `python`, `sql`, `diff`, `dockerfile`, `ini` and `markdown`. `highlight` is a list of line numbers, counted from 1; an editor may type a range (`2-3, 7`), but what is stored is the list. Its one presentation option is `width`, with the values of the vocabulary: because the block is in both zones, an article is offered `full` too.

**Highlighted lines at save.** On `create`, `update` and `clone`, and in the dry run and the apply of an import, the plugin refuses with `codeHighlightInvalid` ([`docs/api.md`](api.md#errors)) a `highlight` that is not a list or has an entry that is not a whole number from 1 to the number of lines of `code`. A final line break does not open another line, and a `highlight` with a line and no `code` is refused. `null`, an absent `highlight` and an empty list are no lines and are accepted.

Its `cost` is not measured yet (the renderer is the third pull request of micelio-cms#448): it declares that of `prose`, which already styles code, until `npm run perf` of `micelio` measures it.

## Reusable

`reusable` (`section.reusable`) is a reference to a reusable block of the page's site (ADR-0022, section 1; [`docs/api.md`](api.md#reusable-blocks)): its one relation, `reusableBlock`, targets `plugin::micelio.reusable-block`. It has no presentation options of its own: the block it points to keeps its own. Like any page section it may carry a `group` key, and in a group it is a member like any other. The palette of the builder does not list it among the catalogue's groups: a reference is made from a reusable block of the site, never empty from the catalogue.

Its `cost` is not measured yet (the renderer is bogd3v/micelio#896, the measurement bogd3v/micelio#981). Until then it declares the most a page section without an island adds, the CSS of `pricing` and the JS of `newsletter`, since its target is one page section; its target's own cost is what the page budget measures at publish.

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

## Icons

An icon in a block is a **name** of the icon catalogue ([`docs/icons.md`](icons.md), ADR-0021 of `micelio`), never a file: `icon: 'map-pin'`. The fields of this section are the contract side every icon field uses; no block has one yet.

**The declaration.** A block declares an icon as `icon: { required: boolean }` (ADR-0021, section 1), written in its `schema`, or a part's, with the field kind `icon({ required })` of `contract/fields.ts`. It is the custom field `micelio.icon` (`plugin::micelio.icon`, a string), so the save checks the name against the pinned set (`iconInvalid`, [`docs/api.md`](api.md#errors)). An icon is never required on an existing block (ADR-0021, section 6): adding one is an optional field, a MINOR of the contract.

- **Beside text** (`iconFields({ required: false })`): the icon is decorative and no label is asked.
- **Standing alone**, with no text beside it (a social link, an icon-only button: `iconFields({ required: false, alone: true })`): the part also requires a `label`, which the frontend renders as the icon's accessible name.

The generated schema marks the field with `x-micelio-icon`, the declaration (`{ required, alone }`), next to its `x-strapi` (`{ type: customField, customField: plugin::micelio.icon }`), and describes the value as a kebab-case name of `icons.schema.json`.

**`iconStyle`.** A block with an icon field offers the `iconStyle` option ([above](#presentation-options)), which draws all of its icons, and a block without one does not. `iconIssues` in `contract/strapi.ts` checks it, with the label of an icon that stands alone and the cost below; `npm run blocks:generate` and `lint:blocks` stop on an entry that breaks one of them.

**Cost.** An icon is delivered in one sprite inlined in the page, never as a request (ADR-0021, section 3), so a block with an icon field declares `cost.icons`: the gzip bytes of the sprite entries its icons add, as `docs/performance.md` of `micelio` ("Icons: the cost of a sprite entry") measures an entry. Raw, an entry is 340 bytes at the median and 562 at the 90th percentile of the set; the 16 entries of the specimen's sprite are 1 549 bytes gzip, wrapper included. The reference below adds the number to the block's **Cost** line. A block without an icon field declares none. Every total of a block's cost adds it to the CSS and JS (`costBytes`, `contract/cost.ts`): the palette and the block panel of the builder, `costKb` of the Block catalogue page (`GET /micelio/block-settings?site=`) and the weight of a page template.

**The fields that take one.** The block catalogue plan of `micelio` (`docs/architecture/block-catalogue-plan.md`, "Icons") picks four fields for step 1, each `required: false`. Each lands with its block's line of the plan, with the change of `micelio-cms` that adds the field to the component:

| Block          | Field                  | Beside text or alone                                              | Plan line |
| -------------- | ---------------------- | ----------------------------------------------------------------- | --------- |
| `feature-grid` | `feature-item.icon`    | Beside text: decorative                                           | 17        |
| every link     | `link.icon`            | Beside its label; with `iconPosition: only`, the `label` names it | 18        |
| `stats`        | `stat.icon`            | Beside text: decorative                                           | 33        |
| `pricing`      | `plan.features[].icon` | Beside text: decorative                                           | 41        |

A brand's own mark is the one exception, `customIcon` (an upload, ADR-0021, section 7), offered only where a later entry allows it (`logo`, `badge`) and never with `icon` on the same item; none of the four does.

## How a schema maps to Strapi

Each block's JSON Schema describes its content as the content API answers it, its options included (it is an option, and ADR-0018 keeps it stored inside the component until a migration moves it). An optional field may be absent or `null`; a field Strapi requires is in `required`. What JSON Schema cannot say about the Strapi attribute is in the `x-strapi` keyword of the field:

| `x-strapi.type`                                         | JSON Schema                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `string`, `text`                                        | `string`, with `pattern`, `minLength` and `maxLength`                           |
| `richtext`                                              | `string` with `contentMediaType: text/markdown`                                 |
| `integer`, `boolean`                                    | `integer` with `minimum` and `maximum`, `boolean`                               |
| `enumeration`                                           | `string` with `enum`                                                            |
| `json`                                                  | The value's own schema (`highlight`: a list of integers from 1)                 |
| `media`, with `multiple` and `allowedTypes`             | An uploaded file (`url`, `mime` and more), or a list of them                    |
| `relation`, with `relation` and `target`                | An entry with its `documentId`                                                  |
| `component`, with `component` and `repeatable`          | The part's object, or a list of them with `minItems`, `maxItems`                |
| `customField`, with `customField: plugin::micelio.icon` | A string: a name of the icon catalogue, with `x-micelio-icon` ([Icons](#icons)) |

`default` is Strapi's default, filled in when an entry is created. `test/blocks.test.ts` reads every schema back as Strapi attributes (`contract/strapi.ts`) and compares them, less the options of the vocabulary that `v0.4.0` does not store yet, with the component JSON of `micelio-cms` in `test/fixtures/micelio-cms-components-with-ids.json`: the components of `v0.4.0` plus the `blockId` and `itemId` attributes as `micelio-cms` stores them since #477 (its `source` names the commit and the tag it derives from). That fixture is test data, never registered as a component; a catalogue update regenerates it from the new tag in the same pull request:

```bash
node test/fixtures/micelio-cms-components.mjs <micelio-cms checkout> <tag>
```

## Known limitations

- **`newsletter` in dynamic mode.** The form submits only once the page is hydrated, so it needs JavaScript there. Static and landing builds render the static form (`MycNewsletterStatic`), which works with no JavaScript. Closing the gap is a change to the frontend, out of the scope of the catalogue.

## How cost is measured

`cost` follows ADR-0018, section 1: the gzip bytes of the block's CSS and JS on a page, and, for an island, the JS it loads once used. HTML bytes are not part of it, except the sprite entries of a block's icons (`cost.icons`, [Icons](#icons)). It was measured on `micelio` `v0.4.0` (`ef5c979`), the frontend of release line 0.4 that pairs with `micelio-cms` `v0.4.0`, in the `bogota` and `starter` themes; the catalogue declares the larger of the two.

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
| `gallery`        | 425           | 220            | 1242         | 1251          |
| `scene`          | 601           | 434            | 1299         | 1303          |
| `prose`          | 1895          | 1895           | 610          | 609           |
| `quote`          | 293           | 293            | 258          | 259           |
| `media`          | 543           | 543            | 1395         | 1400          |
| `slider`         | 1545          | 1545           | 2601         | 2615          |
| `playground`     | 633           | 633            | 1757         | 1758          |

`prose` carries the Markdown styles (`.myc-prose`, code blocks, callouts), which an article page loads anyway. A higher declared cost is a PATCH with the reason and the numbers (ADR-0018, section 2).

<!-- blocks:reference:start (npm run blocks:generate) -->

## Blocks

| id               | Component                | `variant` (default first)         | Other options                                   | CSS (B gzip) | JS (B gzip) | Island                 |
| ---------------- | ------------------------ | --------------------------------- | ----------------------------------------------- | ------------ | ----------- | ---------------------- |
| `hero`           | `section.hero`           | `centered`, `split`, `full-bleed` | `layout`, `align`, `tone`, `height`             | 737          | 1556        | No                     |
| `feature-grid`   | `section.feature-grid`   | `grid`, `list`, `bento`           | `columns`, `density`, `align`, `tone`           | 643          | 1350        | No                     |
| `media-showcase` | `section.media-showcase` | `left`, `right`, `stacked`        | `align`, `tone`, `ratio`                        | 214          | 1423        | No                     |
| `stats`          | `section.stats`          | `row`, `cards`                    | `columns`, `align`, `tone`                      | 527          | 540         | No                     |
| `logo-cloud`     | `section.logo-cloud`     | `row`, `marquee`                  | `columns`, `density`, `align`, `tone`           | 497          | 1446        | No                     |
| `testimonials`   | `section.testimonials`   | `single`, `grid`                  | `layout`, `columns`, `density`, `align`, `tone` | 599          | 1482        | No                     |
| `pricing`        | `section.pricing`        | `cards`, `table`                  | `columns`, `align`, `tone`                      | 805          | 1186        | No                     |
| `faq`            | `section.faq`            | `list`, `two-columns`             | `density`, `align`, `tone`                      | 527          | 525         | No                     |
| `cta`            | `section.cta`            | `banner`, `card`                  | `layout`, `align`, `tone`                       | 483          | 803         | No                     |
| `post-list`      | `section.post-list`      | `cards`, `list`, `featured`       | `columns`, `density`, `align`, `tone`           | 376          | 768         | No                     |
| `newsletter`     | `section.newsletter`     | `inline`, `card`                  | `align`, `tone`                                 | 763          | 1822        | No                     |
| `gallery`        | `section.gallery`        | `grid`, `masonry`                 | `width`, `density`, `align`, `tone`             | 425          | 1251        | No                     |
| `scene`          | `section.scene`          | `background`, `inline`            | `align`, `tone`, `height`                       | 601          | 1303        | `scene` (3d)           |
| `prose`          | `shared.rich-text`       |                                   |                                                 | 1895         | 610         | No                     |
| `quote`          | `shared.quote`           |                                   | `width`, `align`                                | 293          | 259         | No                     |
| `media`          | `shared.media`           |                                   | `width`, `ratio`                                | 543          | 1400        | No                     |
| `slider`         | `shared.slider`          |                                   | `ratio`                                         | 1545         | 2615        | No                     |
| `playground`     | `shared.playground`      |                                   | `height`                                        | 633          | 1758        | `playground` (runtime) |
| `code`           | `shared.code`            |                                   | `width`                                         | 1895         | 610         | No                     |
| `reusable`       | `section.reusable`       |                                   |                                                 | 805          | 1822        | No                     |

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
| `eyebrow`       | string                 | No       |         |
| `anchor`        | string                 | No       |         |
| `title`         | string                 | Yes      |         |
| `text`          | text                   | No       |         |
| `primaryLink`   | `section.link`         | No       |         |
| `secondaryLink` | `section.link`         | No       |         |
| `media`         | media (images, videos) | No       |         |
| `group`         | `section.group`        | No       |         |

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
| `eyebrow` | string                             | No       |                       |
| `anchor`  | string                             | No       |                       |
| `title`   | string                             | No       |                       |
| `text`    | text                               | No       |                       |
| `items`   | `section.feature-item`, repeatable | No       | at least 3; at most 6 |
| `group`   | `section.group`                    | No       |                       |

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
| `group`   | `section.group`        | No       |         |

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
| `eyebrow` | string                     | No       |                       |
| `anchor`  | string                     | No       |                       |
| `title`   | string                     | No       |                       |
| `items`   | `section.stat`, repeatable | No       | at least 2; at most 4 |
| `group`   | `section.group`            | No       |                       |

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
| `eyebrow` | string                     | No       |            |
| `anchor`  | string                     | No       |            |
| `title`   | string                     | No       |            |
| `logos`   | `section.logo`, repeatable | No       | at least 1 |
| `group`   | `section.group`            | No       |            |

### `testimonials`

- **Component:** `section.testimonials` (page sections)
- **Options:**
  - `variant`: `single`, `grid`; default `single`
  - `layout`: `centered`, `split`, `stacked`; default `centered`
  - `columns`: `2`, `3`, `4`; default `3`
  - `density`: `comfortable`, `compact`; default `comfortable`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 599 B of CSS and 1482 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript.

| Field     | Type                              | Required | Details    |
| --------- | --------------------------------- | -------- | ---------- |
| `blockId` | string                            | No       |            |
| `eyebrow` | string                            | No       |            |
| `anchor`  | string                            | No       |            |
| `title`   | string                            | No       |            |
| `items`   | `section.testimonial`, repeatable | No       | at least 1 |
| `group`   | `section.group`                   | No       |            |

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
| `eyebrow` | string                     | No       |            |
| `anchor`  | string                     | No       |            |
| `title`   | string                     | No       |            |
| `text`    | text                       | No       |            |
| `plans`   | `section.plan`, repeatable | No       | at least 1 |
| `group`   | `section.group`            | No       |            |

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
| `eyebrow` | string                         | No       |            |
| `anchor`  | string                         | No       |            |
| `title`   | string                         | No       |            |
| `items`   | `section.faq-item`, repeatable | No       | at least 1 |
| `group`   | `section.group`                | No       |            |

### `cta`

- **Component:** `section.cta` (page sections)
- **Options:**
  - `variant`: `banner`, `card`; default `banner`
  - `layout`: `centered`, `split`, `stacked`; default `centered`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 483 B of CSS and 803 B of JS, gzip
- **Static:** Itself: the block needs no JavaScript.

| Field           | Type            | Required | Details |
| --------------- | --------------- | -------- | ------- |
| `blockId`       | string          | No       |         |
| `eyebrow`       | string          | No       |         |
| `anchor`        | string          | No       |         |
| `title`         | string          | Yes      |         |
| `text`          | text            | No       |         |
| `primaryLink`   | `section.link`  | No       |         |
| `secondaryLink` | `section.link`  | No       |         |
| `group`         | `section.group` | No       |         |

### `post-list`

- **Component:** `section.post-list` (page sections)
- **Options:**
  - `variant`: `cards`, `list`, `featured`; default `cards`
  - `columns`: `2`, `3`, `4`; default `3`
  - `density`: `comfortable`, `compact`; default `comfortable`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 376 B of CSS and 768 B of JS, gzip
- **Static:** Itself: the posts are rendered with the page.

| Field         | Type                                   | Required | Details                                              |
| ------------- | -------------------------------------- | -------- | ---------------------------------------------------- |
| `blockId`     | string                                 | No       |                                                      |
| `eyebrow`     | string                                 | No       |                                                      |
| `anchor`      | string                                 | No       |                                                      |
| `title`       | string                                 | No       |                                                      |
| `category`    | relation to `plugin::micelio.category` | No       |                                                      |
| `tag`         | relation to `plugin::micelio.tag`      | No       |                                                      |
| `count`       | integer                                | Yes      | at least 1; at most 12; default `3`                  |
| `showExcerpt` | boolean                                | No       | default `true`                                       |
| `sort`        | enumeration                            | No       | `newest`, `oldest`, `alphabetical`; default `newest` |
| `group`       | `section.group`                        | No       |                                                      |

### `newsletter`

- **Component:** `section.newsletter` (page sections)
- **Options:**
  - `variant`: `inline`, `card`; default `inline`
  - `align`: `start`, `center`; default `start`
  - `tone`: `default`, `raised`, `accent`; default `default`
- **Cost:** 763 B of CSS and 1822 B of JS, gzip
- **Module:** `newsletter`; not offered on a site that has it off in `site.modules`
- **Static:** In static builds, the static form (`MycNewsletterStatic`). In dynamic mode the form submits only once hydrated (a known limitation, `docs/blocks.md`). Nothing when the `newsletter` module is off.

| Field            | Type            | Required | Details |
| ---------------- | --------------- | -------- | ------- |
| `blockId`        | string          | No       |         |
| `eyebrow`        | string          | No       |         |
| `anchor`         | string          | No       |         |
| `title`          | string          | No       |         |
| `text`           | text            | No       |         |
| `buttonLabel`    | string          | No       |         |
| `consentText`    | text            | No       |         |
| `successMessage` | string          | No       |         |
| `placeholder`    | string          | No       |         |
| `group`          | `section.group` | No       |         |

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
| `eyebrow` | string                  | No       |         |
| `anchor`  | string                  | No       |         |
| `title`   | string                  | No       |         |
| `images`  | media, several (images) | Yes      |         |
| `group`   | `section.group`         | No       |         |

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

| Field     | Type            | Required | Details |
| --------- | --------------- | -------- | ------- |
| `blockId` | string          | No       |         |
| `eyebrow` | string          | No       |         |
| `anchor`  | string          | No       |         |
| `model`   | media (files)   | Yes      |         |
| `poster`  | media (images)  | Yes      |         |
| `alt`     | string          | Yes      |         |
| `title`   | string          | No       |         |
| `text`    | text            | No       |         |
| `group`   | `section.group` | No       |         |

### `prose`

- **Component:** `shared.rich-text` (page sections, and article and About blocks)
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

### `code`

- **Component:** `shared.code` (page sections, and article and About blocks)
- **Options:**
  - `width`: `prose`, `wide`, `full`; default `prose`
- **Cost:** 1895 B of CSS and 610 B of JS, gzip
- **Static:** Itself: the code is highlighted on the server and needs no JavaScript. A copy button, if the theme offers one, is a progressive enhancement and is absent without JavaScript.

| Field       | Type        | Required | Details                                                                                                                             |
| ----------- | ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `blockId`   | string      | No       |                                                                                                                                     |
| `code`      | text        | No       |                                                                                                                                     |
| `language`  | enumeration | No       | `bash`, `shell`, `javascript`, `typescript`, `json`, `yaml`, `xml`, `css`, `python`, `sql`, `diff`, `dockerfile`, `ini`, `markdown` |
| `filename`  | string      | No       |                                                                                                                                     |
| `highlight` | json        | No       |                                                                                                                                     |
| `caption`   | text        | No       |                                                                                                                                     |

### `reusable`

- **Component:** `section.reusable` (page sections)
- **Options:** none
- **Cost:** 805 B of CSS and 1822 B of JS, gzip
- **Static:** The block it references, as that block renders with no JavaScript; nothing while the target has no published version in the page's locale.

| Field           | Type                                         | Required | Details |
| --------------- | -------------------------------------------- | -------- | ------- |
| `blockId`       | string                                       | No       |         |
| `reusableBlock` | relation to `plugin::micelio.reusable-block` | No       |         |
| `group`         | `section.group`                              | No       |         |

## Parts

Nested components: each exists only inside the `schema` of the blocks listed with it.

### `section.faq-item`

Nested in `faq`.

| Field         | Type     | Required | Details         |
| ------------- | -------- | -------- | --------------- |
| `itemId`      | string   | No       |                 |
| `question`    | string   | Yes      |                 |
| `answer`      | richtext | Yes      |                 |
| `defaultOpen` | boolean  | No       | default `false` |

### `section.feature-item`

Nested in `feature-grid`.

| Field    | Type           | Required | Details |
| -------- | -------------- | -------- | ------- |
| `itemId` | string         | No       |         |
| `icon`   | media (images) | No       |         |
| `title`  | string         | Yes      |         |
| `text`   | text           | No       |         |

### `section.group`

Nested in `hero`, `feature-grid`, `media-showcase`, `stats`, `logo-cloud`, `testimonials`, `pricing`, `faq`, `cta`, `post-list`, `newsletter`, `gallery`, `scene`, `reusable`.

| Field     | Type        | Required | Details                       |
| --------- | ----------- | -------- | ----------------------------- |
| `groupId` | string      | Yes      |                               |
| `tone`    | enumeration | Yes      | `default`, `raised`, `accent` |

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

| Field       | Type           | Required | Details                    |
| ----------- | -------------- | -------- | -------------------------- |
| `itemId`    | string         | No       |                            |
| `quote`     | text           | Yes      |                            |
| `author`    | string         | Yes      |                            |
| `role`      | string         | No       |                            |
| `avatar`    | media (images) | No       |                            |
| `sourceUrl` | string         | No       | matches `^https?:\/\/\S+$` |
| `logo`      | media (images) | No       |                            |
| `rating`    | integer        | No       | at least 1; at most 5      |

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
