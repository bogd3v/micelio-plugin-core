# About page

**Kind:** reference. **About Micelio** is the last item of the Micelio section and is open to every admin user: it shows versions, modes and counts, no configuration and no secret. It is in English and Spanish.

## What it shows

- **Versions and compatibility**: the plugin and the core release line it supports, Strapi, Node and the database, each site's frontend with the version it reports on `GET /_health` and whether it answered, the `@micelio/*` plugins enabled next to the core, and whether a newer release line is out.
- **Diagnostics**: the text **Copy diagnostics** puts on the clipboard, shown as it is. It holds the versions, the sites' slugs (the default first), the modules turned on, the themes the sites pin, the size of the block catalogue, the entries in review, the database engine and version, the uploads provider and whether an email provider is set, and the time. It holds no email, token, host name, URL or content; paste it in an issue or a support request.
- **Where to go**, **Licence and credits**: links and the notices (AGPL-3.0-only, the theme exception, Strapi's trademark, `TRADEMARKS.md`).

## When it asks something

Never on page load. The frontends' health and the release feed are read when Strapi starts, once a day (the job of `statusRefreshRule`, [status-page.md](status-page.md)) and when someone presses **Run checks again**, which asks the frontends again but reads the release feed only if the last read is over a day old, and at most five times a minute per user. The page shows the last answers.

`MICELIO_UPDATE_CHECK=false` turns the release feed off: nothing is requested for it, and the row says so. It is on by default. The request is one `GET` of the latest release of the core on GitHub (`https://api.github.com/repos/bogd3v/micelio/releases/latest`) with no identifier; `MICELIO_UPDATE_FEED` names another URL with the same answer (`tag_name`, `html_url`), for a mirror. A feed that does not answer shows _not known_, never an error. The frontends are the sites' own and are asked either way.
