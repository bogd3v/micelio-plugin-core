# Themes page

**Kind:** how-to. The **Themes** page of the Micelio section (group **Site**) shows, for one site at a time, the themes its frontend holds, those of the registry and the updates, each with the result of its admission report; it previews a theme on the site's own pages beside the active one, activates it and reverts the last activation. It is in English and Spanish. The routes are in [docs/api.md](../api.md#themes).

## Who may use it

A role with **Change the theme of a site** (`plugin::micelio.themes.manage`, in Settings → Roles → Plugins → Micelio). Strapi gives a new plugin permission to the **Super Admin** only, which keeps ADR-0009 of `micelio`, section 3: only the Super Admin changes the theme. The permission opens the page, the theme preview and their three routes.

A Super Admin who gives it to another role lets that role change the theme pin of **every** site, and so what the frontend downloads and installs from the registry: a data-only theme the pin names is installed at runtime (ADR-0009, section 3). Give it only to roles you would trust with that.

The Content Manager still edits the pin (**Content Manager → Site → Theme**), as before (#180): the page adds a way, it removes none. A change made there is not in the page's log.

## What the page reads

The plugin's server asks the site's frontend, at the origin of the site's `url`, for `GET /api/theme/status` and `GET /api/theme/catalogue`, at most two seconds each, every time the page loads. The browser never calls the frontend or the registry. The frontend must be a `micelio` image that serves both routes (bogd3v/micelio#403 and #993) and the preview of a theme (bogd3v/micelio#736); a frontend that does not answer is said so on the page, which then shows no theme and activates nothing.

- **Installed**: the themes of the frontend's stores, with version, contract, whether they ship code, and the store (built into the image, or installed on this deployment). The theme the frontend renders is marked **Active**.
- **Available in the registry**: the newest version of each theme of the registry's index, with its tier, licence and whether it runs on this core. When the frontend could not read the index, the page shows why.
- **Updates**: a newer version of an installed theme that runs on this core.
- Each theme shows **Admitted** or **Refused at admission**, and the summary of its admission report, when the frontend read one. Contrast and axe come from that report: they were checked at admission and do not depend on the site's content.

## Preview

**Preview on <site>** opens the theme preview: a page of the site, the newest draft of the page type chosen above the frames, in the active theme and in the candidate, side by side. **As static site** shows both as the static site renders them. Each frame is loaded with a preview token of its own (`POST /micelio/preview/token`, [docs/operate/preview.md](preview.md)); the candidate's token carries the theme, never the frame's address (ADR-0019 of `micelio`, amendment of 2026-11-25). The frontend keeps one preview grant per browser, in one cookie, so the candidate's frame asks for its token only once the current one has loaded, and the page reloads neither frame on its own: after the grant's 15 minutes, a link inside a frame no longer opens a draft, and changing the page type or the mode loads both again. A preview installs and activates nothing, so a theme in none of the frontend's stores cannot be previewed: the page says so instead of loading a frame. A code theme the image was not built with is previewed on the core's default slots. The preview needs what any preview needs: the permission `plugin::micelio.preview` and the right to read the page.

## Activate

**Activate** writes the site's theme pin (the `theme` component of the site; its mode, accents and font are kept):

| The theme                                             | The pin written                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Built into the frontend's image (`available.builtIn`) | `themeId` alone                                                                                                           |
| Data-only, in the deployment store or the registry    | `themeId`, `themeVersion` and `themeDigest` (the package digest the catalogue lists); the frontend installs it at runtime |
| A code theme the image was not built with             | Nothing: refused with `themeRebuildRequired`. The page shows **Needs a rebuild** instead of the button                    |

A code theme activates only on an image built with it (ADR-0009, section 4): the operator rebuilds the frontend's image with the theme in its `themes.lock.json`, deploys it, and the theme is then built in. The page never falls back to the default slots for it.

The frontend reads the pin when it renders a page of the site, once its cache of the site settings (up to a minute) has expired, and switches in the background: a site nobody visits does not switch until someone does, so the page links to the site while it waits. The page reads its status every three seconds, for three minutes at most, until it renders the theme asked for or says why not (a pin it refused, a registry it could not reach, an install that failed).

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
