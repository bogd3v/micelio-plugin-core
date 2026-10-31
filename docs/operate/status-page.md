# Status page

The **Micelio** entry of the admin's menu, marked with the Micelio icon, opens the Micelio section, whose first page is the status page: the operator's first view of an installation, what runs, what is reachable and what failed. It changes no content: besides reading, it can only run the host check again. It is in English and Spanish, as the admin is.

## Who sees it

A role with the permission **Read the Micelio status page** (`plugin::micelio.status.read`, in Settings → Roles → Plugins → Micelio). The super admin has it; the Editor and Author roles do not, since the page shows the host's configuration. Give it to another role there.

The menu entry itself needs no permission: any admin user sees it. A role without the status permission does not see **Status** in the sub-navigation and lands on **About Micelio**, which shows no configuration ([about-page.md](about-page.md)); the pages of sibling plugins show to the roles that have their permission.

## What it shows

| Section    | What                                                                                                                                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin     | The plugin's version, the core release line it supports (`micelio` in its `package.json`), the number of blocks in the catalogue ([docs/blocks.md](../blocks.md)) and of sites                                                                                             |
| Host check | Each check of the latest run with its result (passes, fails, skipped), whether it is required, what it found and, when it fails, the fix ([host-check.md](host-check.md)). **Run again** runs the check now and replaces the results                                       |
| Frontends  | Each distinct origin of the sites' `url`, the sites behind it and what it answered on `GET /_health`: its version, or **Not available** when it did not answer                                                                                                             |
| Plugins    | One card for each sibling plugin that registers checks (the fediverse plugin, for one) and whose permission you have: the result of each check for each site, what it found and the fix. It shows when the checks last ran, or that they have not run since Strapi started |
| Sites      | Each site's name, slug, host names and frontend origin; the default site first                                                                                                                                                                                             |

**Not available** is not a failure. The frontend's health endpoint arrives with bogd3v/micelio#702; until a frontend serves it, or while it is down, the page says it did not answer. The page asks every frontend again each time it loads, at most two seconds each.

The checks of the plugins never run when the page loads: they run with **Run again** and once a day (`statusRefreshRule`, [README](../../README.md#configuration)). **Copy diagnostics**, at the end of the page, copies a few lines for a support request: the versions, whether the host check passes and one line per plugin with how many of its checks are ok, warn or failing. It copies no finding, site name or address.

A sub-navigation on the left lists the Micelio pages in groups (Overview, Content, Site, About); a group with no page the user may see is left out. Sibling plugins add pages to the first three ([extension points](../plugins/extension-points.md)). The status page keeps its address, `/admin/plugins/micelio`.

The host check runs when Strapi starts, before the frontends are usually up. **Run again**, in the Host check section, runs it now: use it after fixing a failure, or once the frontends are up. It never stops Strapi, even in production when a required check fails; restarting does. Without access to the page, `npx micelio doctor` in the Strapi project's folder runs the same checks.

The data comes from `GET /micelio/status` ([docs/api.md](../api.md#status)).
