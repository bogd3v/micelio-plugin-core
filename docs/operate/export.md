# Export a site

**Kind:** how-to. Write one site of a Micelio CMS as an archive of the [site export format](../export-format.md), to keep it, move it to another host or hand it to its owner. Importing an archive arrives with bogd3v/micelio-plugin-core#30.

## Write the archive

In the Strapi project's folder, with the environment the CMS runs with:

```bash
npx micelio export <site slug>
```

The command loads the project as `micelio doctor` does: the boot steps run against the configured database and the server does not start, so it can run next to the live CMS. It writes `<site slug>-<UTC date and time>.micelio.tar.gz` in the current folder and prints its path, its number of documents and of media files. `--output <file>` chooses another path. The file appears only once the archive is complete; a failed export leaves nothing behind and exits with `1`, naming the cause and its code (`exportSiteNotFound`, `exportMediaUnreadable`).

## Personal data

Without options the archive holds the site's content and media, and the personal data the site already shows. `--personal` adds the personal data it does not show: the types and attributes that declare `personal` (the format's [What is never exported](../export-format.md#what-is-never-exported)). Handle an archive written with `--personal` like a backup: it says so in its manifest (`"personal": true`), and whoever asks for it, and on what basis, is the operator's responsibility.

No archive holds passwords, tokens, keys, admin users, reader accounts or the instance's configuration, with or without `--personal`.

## From code

Another plugin or a script calls the service with an output stream:

```ts
const manifest = await strapi
  .plugin('micelio')
  .service('siteExport')
  .export({ site: 'example', personal: false }, fs.createWriteStream('example.micelio.tar.gz'))
```

It answers the archive's manifest and refuses with an `ExportError` whose `code` is one of the format's.
