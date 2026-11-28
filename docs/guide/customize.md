# Customize a site

**Micelio → Customize** is where a site owner changes what the site may change without touching
its theme (ADR-0005 of `micelio`, section 8): its identity, the accent of each of the theme's
modes, the display font, the default mode, the modules that are on and the social links. Every
field is already a field of the site (`plugin::micelio.site`); the page is a form over them, for
one site and one locale at a time.

## Who sees it

The page shows to a role that may read the **Site** type in the Content Manager, and **Save** and
**Discard** to a role that may also update it. The save goes through the Content Manager's own
admin API, as the edit view's does, so the rules of the sites (`server/src/sites/rules.ts`) and
the role's field and locale permissions apply. It sends only the fields below: every other field
of the site keeps its value, and the theme's pin (`themeId`, `themeVersion`, `themeDigest`) is
sent back as it was read: the page never changes the theme.

## What it edits

- **Identity**: the name (required), tagline and description, in the locale the page shows; the
  logo, picked from the media library; the default author's name and URL. The name, tagline and
  description are localised: choose `en` or `es` in **Locale**. The logo, author and the rest are
  the same in every locale, so a save in one locale changes them in all. A locale the site has no
  version of yet shows a notice and no form: create that version in the Content Manager first,
  since a save from an empty form would overwrite what every locale shares.
- **Theme and colours**: the theme as the site pins it (or the frontend's default theme), read
  only; a chip per mode of the theme with its accent override, or "theme" with none, and its AA
  result; a colour field per mode (`#RRGGBB`), where **Remove** drops the override; the display
  font, from the five the frontend ships; the default mode, from the modes of the theme.
- **Modules**: a switch for each module. A module that is off ships nothing to the visitor: no
  script, no route, no block in the palette.
- **Social links**: one row per link, the network from the list the site accepts and a URL that
  starts with `http://` or `https://`. The footer shows them with `rel="me"`, so Mastodon can
  verify them.

## The AA result of an accent

The page asks the site's frontend how the theme's contrast matrix comes out with the accents in
the form (`GET /_micelio/contrast`, `docs/api.md` of `micelio`, "Contrast of the active theme"):
the same pairs `npm run theme:check` measures, in every mode. It asks with your own preview grant,
for one page of the site, as the cost meter does (ADR-0019 of `micelio`, amendment of
2026-11-25), and again each time you stop changing an accent for a moment, never on every key.

A mode reads:

- **AA**: the frontend shows the accent as you gave it, and every pair of the mode passes.
- **Fails: the site would show `#…`**: the frontend would move the accent's lightness to the
  nearest shade that passes, so the site would not show your colour. **Use `#…`** puts that
  shade in the field.
- **Fails AA**: no shade of the accent reaches contrast, so the site would keep the theme's own
  accent, or a pair of the mode fails. An accent equal to the theme's own reads this way too:
  **Remove** it.

While a mode is adjusted or fails, **Save** is off, and the line above it names the mode, the pair
(`role` on `surface`), its ratio and the minimum. The rule is the page's only: a save through the
Content Manager, the API or an import still stores any `#RRGGBB`, and the frontend adjusts a
failing accent when it renders the site.

When the contrast cannot be checked, the chips say so and why, and **Save** stays on, because the
frontend still adjusts a failing accent:

- your role may not preview drafts (`plugin::micelio.preview`);
- the site has no page you may read to preview (a Page or an Article of the site);
- the frontend does not answer the route: it predates it, its `NUXT_PREVIEW_ADMIN_ORIGIN` is not
  this admin, or it is down.

The default mode offers the modes the route lists; with no answer, only the saved one and the
theme's default.

## The live preview

**Open with live preview**, at the top of the page, opens the customizer of the site and locale
the page shows (`/admin/plugins/micelio/customize/live?site=<slug>&locale=<code>`): the accent of
each mode beside the site's own page, rendered by its frontend with the accents you type, before
anything is saved. It needs the same permissions as the page: to read the **Site** type to open
it, to update it for **Save** and **Discard**, and **Preview drafts on the frontend**
(`plugin::micelio.preview`) for the frame: without it, or with no Page or Article of the site the
role may read, the pane says why in place of the frame.

- **The top bar**: **Close** (back to this page), the site, the theme as pinned, how many modes
  of the theme have an accent that differs from the saved one ("1 of 2 modes changed · not
  saved"), a tab per mode of the theme (the modes the contrast route lists; the arrow keys move
  between them), **Discard** and **Save**.
- **The accent of the selected mode**: its `#RRGGBB` field, its AA result, **Use `#…`** when the
  frontend would move it to another shade, and **Reset to theme**, which drops the mode's override.
  Only the accent of each mode is an override; every other role is a pair of the matrix.
- **The contrast matrix** of the selected mode: each pair the frontend measures (`role` on
  `surface`), its ratio, the minimum and whether it passes, asked again for the accents in the
  form each time you stop typing.
- **The frame**: the page the contrast check uses (the most recently updated Page, else Article,
  of the site that you may read). Each time you stop changing an accent it loads again with a new
  preview token bound to every mode's accent (`accentOverrides`, `docs/api.md`, "Preview
  overrides"): one token per pause, never one per key, and the admin page itself does not reload.
  The accents travel only in the token's body, never in the frame's URL. The frame shows the mode
  the site renders by default: a tab chooses the accent you edit, not the frame's mode; switch the
  frame's mode with the site's own mode switch inside it.

**Save** writes the accents of every mode, and nothing else of the site: the body is the site's
`theme` alone, with its pin, display font and default mode as they were read. It follows the rule
of this page: off while a mode is adjusted or fails, with the mode, the pair, its ratio and the
minimum under the accent; an unchecked result does not turn it off. **Discard** returns every mode
to the saved accents, and the frame to a token with none. **Escape** closes the customizer, and
asks first when an accent is not saved.

## Not here on purpose

Layout variants, fonts outside the set the frontend ships, spacing and any colour but the accent of
each mode are the theme's (ADR-0005 of `micelio`, section 8); the theme itself is chosen on the
Themes page (#59).

`docs/operate/manual-testing.md`, "Try the Customize page", walks through the page on the
development stack.
