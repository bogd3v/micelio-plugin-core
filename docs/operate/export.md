# Export and import a site

**Kind:** how-to. Write one site of a Micelio CMS as an archive of the [site export format](../export-format.md), to keep it, move it to another host or hand it to its owner, and write such an archive into a CMS.

## Write the archive

In the Strapi project's folder, with the environment the CMS runs with:

```bash
npx micelio export <site slug>
```

The command loads the project as `micelio doctor` does: the boot steps run against the configured database and the server does not start, so it can run next to the live CMS. It writes `<site slug>-<UTC date and time>.micelio.tar.gz` in the current folder and prints its path, its number of documents and of media files. `--output <file>` chooses another path. The file appears only once the archive is complete; a failed export leaves nothing behind and exits with `1`, naming the cause and its code (`exportSiteNotFound`, `exportMediaUnreadable`).

## Personal data

Without options the archive holds the site's content and media, and the personal data the site already shows. `--personal` adds the personal data it does not show: the types and attributes that declare `personal` (the format's [What is never exported](../export-format.md#what-is-never-exported)). Handle an archive written with `--personal` like a backup: it says so in its manifest (`"personal": true`), and whoever asks for it, and on what basis, is the operator's responsibility.

No archive holds passwords, tokens, keys, admin users, reader accounts or the instance's configuration, with or without `--personal`.

## Sections of other plugins

A plugin may add its own files to the archive ([extension points](../plugins/extension-points.md)). A section without personal data is always in it. One with personal data is left out unless you name it: `npx micelio export <site slug> --include <section id>` (repeat the option for more). The archive then says `"personal": true`, handle it like one written with `--personal`, and the export is logged. `--include` with an id no plugin registered fails with `exportSectionUnknown`. On import, a section whose plugin is not installed, or whose version has another major, is listed under `skippedPlugins` of the report and left out.

## Import an archive

On the target CMS, in the Strapi project's folder, with its environment:

```bash
npx micelio import <file> --into default
```

The command reads and checks the whole archive before it writes anything: sizes and SHA-256 of every file, the format version, every document against the target's types, the editorial states, the locales, the site's slug and hosts. Then it stores the media and writes the content in one database transaction, and prints a report as JSON: what it created, replaced, deleted and skipped for each export name, the media it stored and reused, the export names the target has no type for, the editorial role codes the target lacks and the references it could not resolve. A refused archive exits with `1`, names the cause and its code, and leaves the target as it was.

- **`--into <site slug>`** writes the archive's site into an existing site of the target, which keeps its slug and stays the default if it was. A fresh CMS already has a `default` site, so moving a one-site CMS is `--into default`. Without `--into`, the import finds the archive's site by its `documentId` or creates it, and refuses when another site has its slug (`exportSiteSlugTaken`) or one of its hosts (`exportHostTaken`).
- **`--replace`** also deletes the site's documents the archive does not hold, for each type the archive holds. Without it, they are left as they are.
- **Locales** belong to the CMS and its other sites: an archive that uses a locale the target lacks is refused (`exportLocaleMissing`). Add the locale in the admin and run the import again.
- **Run it again** whenever you like: an archive the target already holds writes nothing.

The import is a restore. Published entries are published as they were, with their dates, without the editorial transitions; the target's own upload rules (size limit, denied and allowed types) still apply to every media file.

## From code

Another plugin or a script calls the service with an output or an input stream:

```ts
const manifest = await strapi
  .plugin('micelio')
  .service('siteExport')
  .export({ site: 'example', personal: false }, fs.createWriteStream('example.micelio.tar.gz'))
```

```ts
const report = await strapi
  .plugin('micelio')
  .service('siteExport')
  .import(fs.createReadStream('example.micelio.tar.gz'), { into: 'default', mode: 'merge' })
```

`export` answers the archive's manifest and `import` its report. Both refuse with an `ExportError` whose `code` is one of the format's.
