# Export and import page

**Kind:** how-to. The **Export and import** page of the Micelio section moves a whole site as one archive of the [site export format](../export-format.md): the same exporter and importer as `npx micelio export` and `import` ([export.md](export.md)), with a dry run in between. It is in English and Spanish.

## Who sees it

A role with **Export and import sites** (`plugin::micelio.transfer`, in Settings → Roles → Plugins → Micelio); the super admin has it. An import arrives as drafts unless the file marks an entry published **and** the user may publish that type (the Content Manager's _Publish_ permission on it). For a user who may not, an entry the file schedules loses its schedule too, because the scheduler would publish it: the dry run counts the entries that arrive as drafts for either reason. An import never unpublishes either. The permission still lets a user create and overwrite entries of every type of the site, so give it to roles you would trust with that. **Include personal data in an export** (`plugin::micelio.transfer.personal`) is a second permission: without it the checkboxes for personal data are off and the route refuses them. A section of a sibling plugin with personal data also needs the permission that plugin registered for it.

## What an export holds

Choose the **Site** (one at a time). The checkboxes are:

| Checkbox                    | Off means                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Content                     | The content types are written with no documents                                                              |
| Media files                 | No file in the archive, and no media attribute in the documents (an archive never points to a file it lacks) |
| Site settings and theme pin | The site document keeps its identity (name, slug, hosts, `url`, locale, modules); no theme pin               |
| Drafts and editorial state  | Only the documents that have a published version are written                                                 |
| Subscribers and accounts    | (off by default) The types that declare personal data; the archive says `"personal": true`                   |
| One per personal section    | (off by default) A sibling plugin's section with personal data, such as the fediverse's followers            |

API tokens, admin users, sessions and environment variables are never in an archive. Every export that holds personal data is logged (the site and the admin user's id, never their name or email).

**Prepare the export** queues a job that runs in the background, one at a time. When it is done the row under **Previous exports** has a **Download** for the user who made it; other users see who did. The address holds a random token, not the row's number, and a personal export asks for its permissions again when it is downloaded. The file is kept for **24 hours**, then removed and the row says _expired_. The archives live in `transfersDirectory` of the plugin's config (by default `<project>/.tmp/micelio-transfers`); put it outside the project when that folder is read-only. A restart marks an export that was running as failed. The format writes one archive per site: there are no parts.

## Import

Choose an archive under **Import into <site>**. The archive is checked whole, as the command does, and kept for 24 hours (an archive over `transferMaxBytes` of the plugin's config, 1 GiB uncompressed by default, is refused before it is written; one user keeps at most three uploads); the **Dry run** table says per kind how many entries are _in the file_ and how many would be _created_, _updated_ or _skipped_, how many media files the library already holds (reused by digest), and whether the theme pin matches the site's. Warnings list what would be left out: references to nothing, types this CMS lacks, editorial roles it lacks and sections no plugin reads. The dry run writes nothing.

**On an existing entry** is the policy (`existing` in [export.md](export.md)): **Skip** (the default) leaves what the site has, **Update** replaces it with the file's, **Keep both** adds the file's entries as new ones. Changing it runs the dry run again. An archive written from another site of this CMS has the same `documentId`s as that site's entries: only **Keep both** can import it, and the page says so.

**Import n items** writes only with the policy of the last dry run. The import is one transaction and idempotent; the report (created, updated, skipped, media stored and reused) is kept in the site's history. The site's slug, default flag, name, hosts and `url` are never changed; with _Skip_ and _Keep both_ the rest of its settings are kept too, and _Update_ rewrites them.
