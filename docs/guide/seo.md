# SEO and social

The **SEO and social** tab of the page settings holds the fields of a page's `seo` component
(`shared.seo` of `micelio-cms`): the meta title, the meta description and the social image come
from the page and the editor edits them second, a preview shows the page in a search result, a
link card and a fediverse post, and the checks say whether the page is ready for review. The tab
is there for a page type made with `withPageSettings` that has a `seo` attribute of the
component `shared.seo`; another type has the General tab alone.

## What starts from the page

When a field is empty at save the plugin fills it (`server/src/seo/documents.ts`,
`contract/seo.ts`), and the tab shows the same default while the field is empty:

| Field            | Default                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta title       | The page's title and the site's name, `Title · Site`, within 60 characters: the name goes first, then the title is cut at a word                                  |
| Meta description | The first paragraph, from 50 to 160 characters, of the page's blocks in order (a hero's `text`, a rich text's or prose's `body`); none if no paragraph reaches 50 |
| Social image     | The `media` of the first `hero` block, when it is an image                                                                                                        |

A field that has a value is never touched, so what you write stays. A field you empty is filled
again the next time the page is saved. A save that names none of the title, the `seo` component
and a dynamic zone, and a transition, derive nothing: the checks before review read what the draft
holds, so a page saved before the plugin is refused until its fields are filled (below).

A save that stores no description, because no paragraph of 50 characters is there to derive one
from, is not refused, even when the host's `seo` component requires a description. On such a host
a page that has no `seo` component yet is saved without one (the meta title waits for a description
too), so a page type without the editorial workflow can be saved and published without one; an
editorial page is refused when it leaves `draft`, with `metaDescriptionMissing` (below).

The tab of a page in `draft` saves the defaults it shows when it opens, so what its checks list is what the server holds. A page in any other state is not saved by opening the tab (a save would move a scheduled page back to `draft`): it shows the defaults, and they are saved with your next edit.

## Counters never hold a save

The title counter reads `42 / 60`; the description's `118 / 160 · min 50`. Past the limit the
counter says how far (`170 / 160: 10 over`) and turns red, and the save still goes through: the
plugin lifts the `maxLength` that `micelio-cms` declares on `metaTitle` and `metaDescription`
(`liftSeoLimits`, at boot), because Strapi enforces it on a draft too. The limits are checked
when the page leaves `draft`.

## The social image

**Choose another** opens the Media Library. **Generate from title** asks the site's frontend for
the card of the draft (`GET /api/preview/:uid/:documentId/card`, a PNG of 1200 by 630 with the
title and the site name in the theme's font and colours, `docs/api.md` of `micelio`), with your
preview session, stores it in the Media Library with the page's title as its alternative text and
sets it as the social image. It needs the preview to be loaded (the card is drawn for the session
the frame holds) and the frontend to have `NUXT_PREVIEW_ADMIN_ORIGIN` set. Nothing goes to a
third party: the card is drawn by the site's own server. The card is not the `og:image` of the
published page; the image the tab stores is.

## The previews

**Search result**, **Link card** and **Fediverse** render the fields as they are typed: the title,
the description, the image and the page's address. They are drawn by the admin from the fields;
no request leaves the site to make them.

## Advanced

Folded by default:

- **Canonical URL** and **Keywords**, as stored.
- **Robots**, read only: it mirrors **Hidden from search engines** of the General tab
  (`noindex`), else the stored `metaRobots`, else `index, follow`.
- **Structured data (JSON-LD).** The tab shows the JSON-LD generated from the page, as `Article`
  for an article (`api::article.article` or the page type `long-read`) and `WebPage` for any
  other page. Write your own in the box below it to replace it: it must be a JSON object, or a
  list of them, each with `@context` and `@type`, up to 20,000 characters. The tab checks it when
  you leave the box, and the server refuses what is not valid at save (`structuredDataInvalid`,
  `400`). Emptying the box goes back to the generated one.

## Checks before review

A page moves out of `draft` (to review, scheduled or published; not back to draft, and not by the
scheduler) only when:

- the meta title is there and has at most 60 characters,
- the meta description is there and has from 50 to 160 characters,
- the social image is there and is 1200 by 630 pixels.

Otherwise the move is refused with `seoInvalid` (`409`), which names each problem in `problems`
(`metaTitleMissing`, `metaTitleTooLong`, `metaDescriptionMissing`, `metaDescriptionTooShort`,
`metaDescriptionTooLong`, `metaImageMissing`, `metaImageSize`) and the builder shows as a
notification. A meta description that only says again the title (what is left of it once the
title is taken out is under 15 characters) is the warning `descriptionRepeatsTitle`: the move goes
through and the send to review dialog lists it. The tab lists the same checks under **Checks
before review**.

**Upgrade note.** Pages that were accepted at send to review before this version are refused over
the SEO limits or with no image. Open each page's SEO and social tab (on a page in `draft` it fills what the page can
give; on a page in review or scheduled, edit a field to save the defaults), choose or generate an image of 1200 by 630, and send it again. A page type without the
`seo` component is not checked.
