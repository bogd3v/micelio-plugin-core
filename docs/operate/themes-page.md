# Themes page

**Kind:** how-to. The **Themes** page of the Micelio section (group **Site**) shows, for one site at a time, the themes its frontend holds, those of the registry and the updates, in three tabs, each theme a card with the result of its admission report; it previews a theme on the site's own pages beside the active one, where the theme is activated, links the active theme to the **Customize** page, and reverts the last activation. It is in English and Spanish. The routes are in [docs/api.md](../api.md#themes).

## Who may use it

A role with **Change the theme of a site** (`plugin::micelio.themes.manage`, in Settings → Roles → Plugins → Micelio). Strapi gives a new plugin permission to the **Super Admin** only, which keeps ADR-0009 of `micelio`, section 3: only the Super Admin changes the theme. The permission opens the page, the theme preview and their three routes.

A Super Admin who gives it to another role lets that role change the theme pin of **every** site, and so what the frontend downloads and installs from the registry: a data-only theme the pin names is installed at runtime (ADR-0009, section 3). Give it only to roles you would trust with that.

The Content Manager still edits the pin (**Content Manager → Site → Theme**), as before (#180): the page adds a way, it removes none. A change made there is not in the page's log.

## What the page reads

The plugin's server asks the site's frontend, at the origin of the site's `url`, for `GET /api/theme/status` and `GET /api/theme/catalogue`, at most two seconds each, every time the page loads. The browser never calls the frontend or the registry. The frontend must be a `micelio` image that serves both routes (bogd3v/micelio#403 and #993) and the preview of a theme (bogd3v/micelio#736); a frontend that does not answer is said so on the page, which then shows no theme. From bogd3v/micelio#1018 on, the catalogue also names each installed theme's name, modes and layout variants, and each report's checks and manual accessibility check; an older frontend's cards show the theme's id instead of its name, no modes or variants, and **Admitted** alone.

The **Site** picker, beside the title, chooses the site; the subtitle names the theme it runs. Three tabs list the themes, **Installed** first:

- **Installed (n)**: the themes of the frontend's stores, the one it renders first, with a 2 px green border and the badge **Active**; the others have **Installed**.
- **Available in the registry (n)**: the newest version of each theme of the registry's index, with the badge **Registry · <tier>** and its licence. The frontend reads the registry once an hour; when it could not read the index, the tab shows why.
- **Updates (n)**: a newer version of an installed theme that runs on this core, with the badge **Update**, the version it replaces, whether the change is major, minor or patch, and what a preview compares.

A card shows the theme's name (its id when the catalogue has none), the line `<id> <version> · contract <c> · code theme|data-only` (and the licence of a registry version), and chips: its modes; the five variants it picked for header, home, post list, article and footer, which a site cannot change; **Admitted**, with **AA** when the report's static and quality checks passed and **budgets pass** when its performance runs did, or **Refused at admission**, or **No admission report**; **Manual a11y check <date>** when the report records a passed check of that version; **Activates without a rebuild** for a data-only theme, **Needs an image built with it** for a code theme the image was not built with; and **Does not run on this core** for a registry version the index marks so. Contrast and axe come from the admission report: they were checked at admission and do not depend on the site's content.

The buttons of a card: the active theme has **Customize**, which opens the [Customize page](../guide/customize.md) of the site (`customize?site=<slug>`), and **Admission report**, which opens the report's summary in a dialog; another installed theme has **Preview on <site>** and **Admission report**; a registry theme **Preview on <site>**; an update **Preview the update**. No card activates a theme: that is done from its preview.

## Preview

**Preview on <site>** opens the theme preview: a page of the site, the newest draft of the page type chosen above the frames, in the active theme and in the candidate, side by side. **As static site** shows both as the static site renders them. Each frame is loaded with a preview token of its own (`POST /micelio/preview/token`, [docs/operate/preview.md](preview.md)); the candidate's token carries the theme, never the frame's address (ADR-0019 of `micelio`, amendment of 2026-11-25). The frontend keeps one preview grant per browser, in one cookie, so the candidate's frame asks for its token only once the current one has loaded, and the page reloads neither frame on its own: after the grant's 15 minutes, a link inside a frame no longer opens a draft, and changing the page type or the mode loads both again. A preview installs and activates nothing, so a theme in none of the frontend's stores cannot be previewed: the page says so instead of loading a frame. A code theme the image was not built with is previewed on the core's default slots. The preview needs what any preview needs: the permission `plugin::micelio.preview` and the right to read the page.

## Activate

**Activate on <site>**, at the top of the theme preview, writes the site's theme pin (the `theme` component of the site; its mode, accents and font are kept):

| The theme                                             | The pin written                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Built into the frontend's image (`available.builtIn`) | `themeId` alone                                                                                                           |
| Data-only, in the deployment store or the registry    | `themeId`, `themeVersion` and `themeDigest` (the package digest the catalogue lists); the frontend installs it at runtime |
| A code theme the image was not built with             | Nothing: refused with `themeRebuildRequired`. The preview shows **Needs a rebuild** instead of the button                 |

A code theme activates only on an image built with it (ADR-0009, section 4): the operator rebuilds the frontend's image with the theme in its `themes.lock.json`, deploys it, and the theme is then built in. The page never falls back to the default slots for it.

The frontend reads the pin when it renders a page of the site, once its cache of the site settings (up to a minute) has expired, and switches in the background: a site nobody visits does not switch until someone does, so the preview links to the site while it waits. The page reads its status every three seconds, for three minutes at most, until it renders the theme asked for or says why not (a pin it refused, a registry it could not reach, an install that failed).

An admin user may activate and revert 5 times a minute, the two together; the page then says when to try again.

## Revert

After an activation the page shows **Revert to <theme>**: it writes back the pin that activation replaced, while the frontend still holds that theme (built in, or the frontend's active or last good theme). A revert is not reverted, and a pin changed in the Content Manager after the activation is not overwritten: the page then offers no revert.

## The log

Each activation and revert is a row of the internal type `plugin::micelio.theme-activation`: the site, the pin before, the pin after, the admin user's id and the time. It is hidden from the Content Manager and the Content-Type Builder and never in a site archive ([export format](../export-format.md#what-is-never-exported)). Each also writes one `info` line to the CMS log:

```text
[micelio] activated theme starter on site default (was theme bogota), admin user 1
```

## Sites other than the default one

Today's frontend reads the theme of the default site only (ADR-0017 of `micelio`, Consequences: multi-site in the frontend is a later record). The page works for any site: the pin of another site is written and logged, and the page says that the frontend does not read it yet.
