# Site export format

**Kind:** reference. Format version `1.1`. The archive that carries one whole site out of a Micelio CMS and into another: its layout, how every content type is written, what is never in it, how an import behaves, and how the format itself changes. It is the source of truth of the site export contract (section 6 of the engineering standard): a release whose archive the previous release can no longer import is a breaking change.

Exporting and importing a whole site is what the preservation network, a move between hosting plans and a client's right to leave rest on (ADR-0017). No exporter or importer exists yet; this document comes first so the content types of the cut-over (release line `0.7`) are designed to serialise. It names every content type of `micelio-cms` at `v0.4.0`, and `test/export-format.test.ts` fails when one of them is missing from [Content types](#content-types).

The words **must**, **must not** and **may** in this document are requirements on an exporter or an importer that claims format `1.x`.

## The archive

An archive is a gzip-compressed POSIX tar file in ustar format, which every pax reader also reads, named `<site slug>-<UTC date and time>.micelio.tar.gz`, for example `example-20261023T120000Z.micelio.tar.gz`. It holds **one site**: an instance with several sites writes one archive per site.

```text
manifest.json
content/site.json
content/article.json
content/page.json
…                        one file per export name of the content types below
media/index.json
media/sha256/<hex>       the bytes of each media file, named by their SHA-256
plugins/<id>/…           the files of a sibling plugin's section, when there are any
```

- Entries are regular files and directories only: no symbolic or hard links, no device files, no absolute paths, no `..` segment. Paths are lower case ASCII.
- Every file is listed in the manifest, and nothing else is in the archive.
- Text files are JSON, UTF-8 without a byte order mark.
- The archive is deterministic: entries in byte order of their path, tar times set to `0`, documents sorted by `documentId`. Two exports of an unchanged site differ only in `exportedAt`.

### The manifest

```json
{
  "format": "micelio-site-export",
  "formatVersion": "1.1",
  "exportedAt": "2026-10-23T12:00:00.000Z",
  "generator": { "name": "@micelio/strapi-plugin-core", "version": "0.2.0" },
  "micelio": "0.7",
  "strapi": "5.58.0",
  "site": { "documentId": "k2v9…", "slug": "example" },
  "locales": [
    { "code": "en", "name": "English (en)", "isDefault": true },
    { "code": "es", "name": "Spanish (es)", "isDefault": false }
  ],
  "theme": { "id": "aurora", "version": "1.2.0", "digest": "sha256-…" },
  "fediverse": {
    "actorId": "https://cms.example.com/fediverse/user/blog",
    "handle": "@blog@cms.example.com"
  },
  "personal": false,
  "plugins": [{ "id": "fediverse", "version": "1.0", "personalData": true, "entries": 1 }],
  "types": [
    {
      "name": "article",
      "uid": "api::article.article",
      "file": "content/article.json",
      "documents": 12
    }
  ],
  "media": { "file": "media/index.json", "count": 30, "bytes": 48213990 },
  "files": {
    "content/article.json": { "sha256": "9f86d0…", "bytes": 18234 }
  }
}
```

| Field           | Meaning                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`        | Always `micelio-site-export`                                                                                                                                                                                      |
| `formatVersion` | `major.minor` of this document. See [Versions of the format](#versions-of-the-format)                                                                                                                             |
| `generator`     | The package and version that wrote the archive                                                                                                                                                                    |
| `micelio`       | The core release line of the instance that exported it (section 7 of the standard)                                                                                                                                |
| `strapi`        | The Strapi version of that instance, for diagnosis only                                                                                                                                                           |
| `site`          | The site's `documentId` and `slug`                                                                                                                                                                                |
| `locales`       | The i18n locales the archive's entries use, with the instance default                                                                                                                                             |
| `theme`         | The theme pin of the site (`themeId`, `themeVersion`, `themeDigest` of its `theme` component), or `null`. The theme package itself is not in the archive: it comes from the registry                              |
| `fediverse`     | The id and handle of the site's fediverse actor, or `null` when it has none. See [Fediverse](#fediverse)                                                                                                          |
| `personal`      | Whether the archive holds the personal data that is not shown on the site. See [What is never exported](#what-is-never-exported)                                                                                  |
| `plugins`       | The sections of sibling plugins written, each with the `id` that names its folder, its `version`, whether it holds personal data and its number of files. `[]` when none. See [Plugin sections](#plugin-sections) |
| `types`         | Each content type written: its export name, the UID it had on the exporting instance, its file and its number of documents                                                                                        |
| `media`         | The media index, the number of media files and their total bytes                                                                                                                                                  |
| `files`         | Every file of the archive except the manifest, with its SHA-256 (lower case hex) and its size in bytes                                                                                                            |

## Integrity

- An importer **must** check, before it writes anything, that every file of `files` is in the archive with that size and that SHA-256, that every file in the archive is in `files`, and that each `media/sha256/<hex>` file hashes to its name. Any mismatch refuses the whole archive (`exportArchiveCorrupt`).
- An importer **must** refuse an entry that breaks the layout rules above (a link, an absolute path, `..`) without extracting it, and **must** stop reading once the uncompressed size passes the sum of `files` plus the tar overhead.
- Every content file is validated against the schema of its type before the import starts. A document that does not validate refuses the archive (`exportDocumentInvalid`, with its export name and `documentId`). The options of the blocks in a dynamic zone are checked as a save checks them (ADR-0018, `docs/blocks.md`): a value the block does not offer refuses the archive the same way, in the dry run too.
- Format `1.x` has no signature. An archive is as trustworthy as where it came from; a hosting provider that needs provenance signs the archive file out of band.

## Documents

A content file holds the documents of one type that belong to the site, in Strapi 5 terms: a document is one `documentId` with one row per locale and per status.

```json
{
  "type": "article",
  "documents": [
    {
      "documentId": "a8c1…",
      "versions": [
        {
          "locale": "en",
          "status": "published",
          "createdAt": "2026-09-01T10:00:00.000Z",
          "updatedAt": "2026-09-02T08:30:00.000Z",
          "publishedAt": "2026-09-02T08:30:00.000Z",
          "data": {
            "title": "…",
            "slug": "…",
            "author": { "ref": "author", "documentId": "f31e…" }
          }
        },
        {
          "locale": "en",
          "status": "draft",
          "createdAt": "…",
          "updatedAt": "…",
          "publishedAt": null,
          "data": {}
        }
      ]
    }
  ]
}
```

- `documentId` is the identity of a document across instances: links, the `articleDocumentId` of other types and fediverse object ids are built from it, so an import keeps it. Numeric `id`s are never written.
- `versions` has one entry per locale and status the document has. A type without i18n writes `locale: null`. A type without draft and publish has only `status: "published"`, as Strapi stores it. A draft-and-publish type writes its draft always and its published version when it has one.
- `data` holds the attributes of the type as the version stores them, by the rules below. Attributes that are not localised are written in every locale's `data`, as Strapi stores them; an importer takes them from the version in the default locale of the manifest when the versions disagree.
- `createdBy` and `updatedBy` (admin users) are not written.
- The `site` relation of a site-scoped type is not written: every document of the archive belongs to `manifest.site`. A document belongs to the site when one of its rows does, so a version stored without the relation (a locale the site itself lacks) is still written.

### Attributes

| Strapi type                                     | Written as                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `string`, `text`, `email`, `uid`, `enumeration` | A JSON string, as stored, or `null`                                                                                         |
| `richtext`                                      | The Markdown as stored, unrendered and unsanitised: it is sanitised on the server when rendered (section 9 of the standard) |
| `integer`, `decimal`, `float`, `biginteger`     | A JSON number; `biginteger` as a string of digits                                                                           |
| `boolean`                                       | `true` or `false`                                                                                                           |
| `datetime`                                      | RFC 3339 in UTC with milliseconds (`2026-10-23T12:00:00.000Z`)                                                              |
| `date`                                          | `YYYY-MM-DD`                                                                                                                |
| `json`                                          | The stored JSON value                                                                                                       |
| `media`, single                                 | `{ "media": "<sha256 hex>" }` or `null`                                                                                     |
| `media`, multiple                               | An array of the same, in the stored order                                                                                   |
| `relation`, to one                              | `{ "ref": "<export name>", "documentId": "…" }` or `null`                                                                   |
| `relation`, to many                             | An array of the same, in the stored order                                                                                   |
| `component`                                     | An object with the component's attributes by these same rules, without its `id`; a repeatable component is an array of them |
| `dynamiczone`                                   | An array of `{ "__component": "<component UID>", "block": "<block id>", …attributes }`. See [Blocks](#blocks)               |
| `password`                                      | Never written                                                                                                               |

Relations:

- A relation is written on the side that owns it (`inversedBy`, or no inverse at all). The side declared with `mappedBy` is not written: the import rebuilds it. At `v0.4.0` that leaves out `author.articles`, `category.articles` and `tag.articles`.
- A relation to a type outside the archive (an admin user, a reader account) is written as `null`, or left out of a to-many array, and listed in [Content types](#content-types) where it happens.
- A relation inside a localised type points at the same locale of the target when it has one, as Strapi links it; only the `documentId` is written.

### Blocks

The components of a dynamic zone are the blocks of ADR-0018. Each item carries both names:

- `block`: the stable id of the block catalogue (`hero`, `feature-grid`, `prose`), which survives the cut-over and any change of the Strapi UID. Absent for a component that is not a block of the catalogue (the `about.*` components, ADR-0018 section 6).
- `__component`: the Strapi UID the exporting instance used (`section.hero`).

An importer resolves an item by `block` first and by `__component` only when `block` is absent. Presentation options (`variant` today) are written where the block stores them; a block whose `schema` changed under ADR-0018 section 2 is migrated by the importer with the same content migration the release ships.

### Media

`media/index.json` lists every media file the site's documents refer to, once, by digest:

```json
{
  "media": [
    {
      "sha256": "2c26b4…",
      "name": "harbour.jpg",
      "mime": "image/jpeg",
      "ext": ".jpg",
      "bytes": 482113,
      "width": 1600,
      "height": 1067,
      "alternativeText": "…",
      "caption": "…",
      "folderPath": "/articles"
    }
  ]
}
```

- `media/sha256/<hex>` is the file as the media library stores it. Strapi may rewrite an image when it is uploaded; the archive holds the stored bytes, not the ones first sent. The derived formats (thumbnails, breakpoints) are not written: the importing instance's upload provider makes its own.
- `url`, `previewUrl`, `provider`, `provider_metadata`, `formats` and Strapi's `hash` are not written: they describe where one instance stores the file, not the file.
- A file that no document of the site refers to is not in the archive.
- An importer reuses a file of the target library with the same name, type and SHA-256. It stores any other file as it is, through the target's upload provider, without the optimisation the target applies to an uploaded image, so that its digest survives a second export; the target makes its thumbnail and formats as for an upload. It applies the target's rules: the size limit, and `security.deniedTypes` and `allowedTypes` on the type the archive declares, which is the type the file is served with. A file the target refuses refuses the archive (`exportMediaRefused`).
- A multiple media attribute that names one digest twice holds it once after an import: the archive holds one file per digest, and Strapi links a file once per attribute.

## Localisation

- Each version carries its `locale`, and the manifest lists the locales used, with the instance default.
- An importer **must** refuse an archive that uses a locale the target instance does not have (`exportLocaleMissing`, naming the locales): locales belong to the instance and its other sites, so the operator adds them.
- A site's own `defaultLocale` is an attribute of `site` and is imported with it.

## Editorial state

A type made with `withEditorial` writes its `editorial` component (`micelio-editorial.editorial`, ADR-0017 section 5) in every version, like any component:

- `state` and `publishAt` are written as they are. `reviewedBy` and `publishedBy` relate to admin users, who are not exported, and are written as `null`.
- The state and the versions agree: an entry in `published` has a published version, and an entry in any other state has none. An archive that breaks this refuses the import (`exportEditorialInconsistent`).
- The import writes the versions as they are, published ones included, as the plugin itself and not as a transition: it does not run the transition policy and it does not fire `afterTransition` or `afterPublish`. It is a restore, not an editorial act. Strapi's own document events (`entry.create`, `entry.publish`) still fire, so a plugin that reacts to them instead of to the core's hooks sees the import; `siteCreated` fires when the import creates the site.
- A `scheduled` entry whose `publishAt` has passed is published by the scheduler at its next run on the target.
- The site's `editorialPolicy` is imported as it is. Its role codes name Strapi admin roles, which are not exported; a code the target does not have is reported by the import and grants nothing.

## Fediverse

The site's fediverse actor is an identity on other servers: remote servers key its followers by its actor id, and its key signs for it. An archive moves the site's content, not that identity.

- The actor key pair (the `keyPairs` entry of the `fediverse` plugin store) is **never** exported, encrypted or not. A new instance has a new actor.
- `manifest.fediverse` records the old actor id and handle, so the new actor can list the old one in `alsoKnownAs` and the old one can send `Move` to its followers. The move itself belongs to the fediverse plugin, not to this format.
- Followers are not exported: they followed the old actor, and the new one must not deliver to them until they follow it. The exception is the block list: with `personal`, followers with `blocked: true` are exported as rows of `fediverse.follower` and imported as blocked.
- The `federatedArticles` entry of the plugin store (which articles the old actor already sent) is not exported: the new actor has sent nothing.
- The site's actor profile (the `fediverse` component of `site`) is exported with the site.

## Plugin sections

A sibling plugin adds files to the archive with `registerExportSection` ([docs/plugins/extension-points.md](plugins/extension-points.md)). Each section has a folder, `plugins/<id>/`, and a `plugins` entry in the manifest.

- Paths inside the folder follow the layout rules above and are listed in `files` like any other file. The format does not say what the files hold: the section's `version` (`major.minor`) does, and its plugin owns it.
- A section with `personalData: true` is **off by default**: an exporter writes it only when asked for by its `id`, and then sets `personal` to `true`. Exporting it is logged.
- An importer **must** hand the files of a section to the plugin that registered it, after the site's content is written and in the same transaction. It **must** skip, and list in its report (`skippedPlugins`, with `unknown` or `version` as the reason), a section no plugin registered or whose major differs from the registered one. A skipped section is not an error.
- A manifest without `plugins` (format `1.0`) has no sections.

## What is never exported

Data is sorted by the levels of `micelio-cms` `docs/security/data.md`. An archive holds:

- **Public** data: published content, drafts (they are the site's own work), media and aggregated counts.
- **Personal data shown on the site**: what a visitor already reads on the public pages, such as the author name, avatar and text of an approved comment.
- **Other personal data only when the exporter is asked for it** (`personal: true`): email addresses, subscribers, comments that are not approved, likes and boosts by actor, the fediverse block list. Who asks, and on what legal basis, is the operator's responsibility; an archive with `personal: true` is handled like a backup.

An archive **never** holds, whatever is asked:

- **Restricted** data, hashed or encrypted or not: passwords, the fediverse actor private key, API token keys, reader confirmation tokens and reset codes, subscriber confirmation and unsubscribe tokens.
- Accounts and sessions: admin users, roles and permissions; reader accounts (`plugin::users-permissions.user`); sessions and refresh tokens.
- Instance configuration: environment variables, plugin stores (the users-permissions settings, the Content Manager layouts), API tokens, the upload provider's settings, rate-limit keys and counters.
- History that is Strapi's: content history versions, releases.

## How a type declares its export

A content type of a Micelio plugin is in the archive when it is made with `withSiteScope`, and the `site` type always is. What it writes follows from its schema, and the type may say more in `pluginOptions.micelio`:

| Declared on  | Key          | Meaning                                                                                                                                                                                                      |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The type     | `exportName` | Its export name. Without it: the singular name for `api::` types and the types of this plugin (`plugin::micelio.site` is `site`), and `<plugin>.<singular name>` for another plugin's (`fediverse.follower`) |
| The type     | `export`     | `personal`: the type is written only with `personal`. `never`: never written                                                                                                                                 |
| An attribute | `export`     | The same, for one attribute, at any depth of its components                                                                                                                                                  |

An attribute that declares nothing is written, except a `private` attribute, which is never written unless it declares `personal` or `always` (the site sections of [plugin extension points](plugins/extension-points.md) declare `always`: private for the content API, they still travel with the site), and a `password`, which is never written whatever it declares. The rows of [Content types](#content-types) are what these declarations must give for each type.

## Content types

Every content type of `micelio-cms` at `v0.4.0`, and the `site`, `category` and `tag` types of this plugin, with its export name and how it is written. The export name is what the archive uses; it never changes, whatever the UID becomes at the cut-over (ADR-0017, section 2). An instance before the cut-over has one site and no `site` relation: an exporter writes all its rows as the default site's.

### Site

| UID                    | Export name | Written                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin::micelio.site` | `site`      | The one document of the archive's site, every attribute and locale. `hosts` is written, and the import refuses a host another site of the target uses (`exportHostTaken`). `isDefault` is written and not imported: the target keeps its default site. A `slug` that another site of the target uses refuses the import (`exportSiteSlugTaken`). `contactEmail` and `privacyContactEmail` are the site's published contacts and are written always |

### Taxonomy

| UID                        | Export name | Written                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin::micelio.category` | `category`  | The type `api::category.category` of `v0.4.0` became in `micelio-cms` 0.5, with the same export name and attributes, and the plugin owns from the release that ships it. Site-scoped: an archive holds the categories of its site. Localised, no draft and publish. The inverse `articles` is not in the plugin (a plugin's type cannot target a type of the host): the distribution adds it, as a `mappedBy` side that is never written, so a site's archive does not carry it until the article moves into the plugin (ADR-0017, amendment of 2026-10-26, D5) |
| `plugin::micelio.tag`      | `tag`       | The same for `api::tag.tag`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Content of `micelio-cms` `v0.4.0`

| UID                              | Export name    | Written                                                                                                                                                                                                                                                                                               |
| -------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api::about.about`               | `about`        | Single type, localised, no draft and publish: one document. `blocks` is a dynamic zone of `about.*` components (no `block` id) and the `prose`, `quote`, `media` and `slider` blocks; `seo` a `shared.seo` component                                                                                  |
| `api::article.article`           | `article`      | Localised, draft and publish. `cover` media; `coverCredit`, `references`, `seo` components; `author`, `category` and `tags` relations (the owning side); `blocks` the `prose`, `quote`, `media`, `slider` and `playground` blocks. `plainText` is private and derived: not written, rebuilt on import |
| `api::article-stat.article-stat` | `article-stat` | Not localised, no draft and publish. Aggregated visitor counts: `articleDocumentId` and `articleLocale` are written as they are, since `documentId`s survive the import                                                                                                                               |
| `api::author.author`             | `author`       | Localised (`bio`), no draft and publish. `avatar` media. `articles` is the inverse side: not written. `email` is private personal data: written only with `personal`                                                                                                                                  |
| `api::category.category`         | `category`     | Localised, no draft and publish. `articles` is the inverse side: not written. From `micelio-cms` 0.5 it is `plugin::micelio.category` ([Taxonomy](#taxonomy))                                                                                                                                         |
| `api::global.global`             | `global`       | Single type, not localised, no draft and publish. `favicon` and `fediverseHeader` media; `defaultSeo` a `shared.seo` component                                                                                                                                                                        |
| `api::page.page`                 | `page`         | Localised, draft and publish. `sections` the page section blocks of ADR-0018 (`hero` to `scene`); `seo` a `shared.seo` component. The `post-list` block's `category` and `tag` relations are written as references                                                                                    |
| `api::site-setting.site-setting` | `site-setting` | Single type, localised. Written only by an instance before the cut-over; its fields carry over to `site` one to one (ADR-0017, section 4), so an importer at or after the cut-over reads it into the archive's `site`. `homePage` is a relation to `page`; `logo`, `favicon`, `defaultOgImage` media  |
| `api::subscriber.subscriber`     | `subscriber`   | Not localised. Written only with `personal`, and then only confirmed subscribers: `email`, `confirmed` and `language`. `confirmationToken` and `unsubscribeToken` are never written, so links in emails sent before the move stop working and the next email carries new ones                         |
| `api::tag.tag`                   | `tag`          | Localised, no draft and publish. `articles` is the inverse side: not written. From `micelio-cms` 0.5 it is `plugin::micelio.tag` ([Taxonomy](#taxonomy))                                                                                                                                              |

### Plugins installed by `micelio-cms` `v0.4.0`

| UID                                    | Export name             | Written                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plugin::fediverse.follower`           | `fediverse.follower`    | Only with `personal`, and only rows with `blocked: true`, as the block list ([Fediverse](#fediverse))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `plugin::fediverse.interaction`        | `fediverse.interaction` | Only with `personal`: `type`, `actorId`, `handle`, `articleDocumentId` and `interactionKey`, so the counts survive the move. Without it the counts start again from zero                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `plugin::comments.comment`             | `comments.comment`      | Comments on the site's articles. Approved and not removed: `content`, `authorName`, `authorAvatar`, `isAdminComment`, `approvalStatus`, `blocked`, `blockedThread`, `fediverseUri`, `fediverseActorHandle`, `threadOf` (a reference to the parent comment) and `related`, written as a reference to the article (`{ "ref": "article", "documentId": … }`) instead of its UID string. With `personal`: every comment, and `authorEmail` and `blockReason`. `authorUser` relates to a reader account and `authorId` holds its numeric id: `authorUser` is written as `null`, `authorId` not at all |
| `plugin::comments.comment-report`      | —                       | Not exported: reports are moderation records about other people, and are resolved on the instance that received them                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `plugin::upload.file`                  | —                       | Written as [Media](#media), not as documents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `plugin::upload.folder`                | —                       | Written as the `folderPath` of each media file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `plugin::i18n.locale`                  | —                       | Written as `manifest.locales` ([Localisation](#localisation))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `plugin::users-permissions.user`       | —                       | Not exported ([What is never exported](#what-is-never-exported))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `plugin::users-permissions.role`       | —                       | Not exported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `plugin::users-permissions.permission` | —                       | Not exported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Strapi's own types (`admin::*`, `plugin::content-releases.*`, `plugin::review-workflows.*`, the history and store tables) are not exported.

A content type added by a Micelio plugin after `v0.4.0` gets its row here in the pull request that adds it, with its export name, before its first release (section 6 of the standard).

## Import

An import writes one archive into one target instance.

- **Matching.** The site is matched by `documentId`. Every document is matched by its export name, the site and its `documentId`, and each version by locale and status. `documentId`s are kept: Strapi's document service takes one in the `data` of a create. A document whose `documentId` the target holds under another site refuses the import (`exportDocumentInvalid`).
- **Into an existing site.** An import may name a site of the target (`into`) instead: the archive's site is written into it, and that site keeps its `documentId`, its `slug` and whether it is the default. A fresh instance has a `default` site of its own, so moving a one-site instance is an import into `default`.
- **Modes.** In `merge` (the default) a matched document is replaced by the archive's versions, a missing one is created, and documents of the site that the archive does not hold are left as they are. In `replace` the site's documents of each type the archive holds that are not in the archive are deleted. Types the archive does not hold are never touched.
- **Existing documents.** An importer may let the caller choose what to do with a matched document: replace it (the default above), leave it as it is, or keep both, which writes the archive's document as a new one under a `documentId` of the importer's own making. The core derives it from the target site, the export name and the archive's id, so the same archive imported again finds its copies; and it is the one way to import a document that another site of the target holds.
- **Idempotent.** Importing the same archive a second time, in either mode, writes nothing: an importer compares each version with what the target holds and skips the ones that are equal.
- **All or nothing.** The content is written in one database transaction. Media is uploaded before it; an importer removes the files it uploaded when the transaction fails.
- **Order.** Media first, then `site`, then the other types in byte order of export name. A reference to a document the import writes later is left out of the first write, and that document is written again once every document exists, in the same transaction.
- **Timestamps.** Each version's `createdAt`, `updatedAt` and `publishedAt` are written as the archive has them.
- **Older formats.** An importer of format `1.y` imports every `1.x` archive, with the content migrations its release ships for the blocks and types that changed since.
- **A report.** The import answers with what it created, replaced, deleted and skipped per export name, the role codes of `editorialPolicy` the target does not have, and every export name it did not know.

Errors are problem details (section 4 of the standard) with these codes. The first two are the exporter's:

| `code`                        | When                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `exportSiteNotFound`          | No site has the slug the export names, or the one an import names with `into`                    |
| `exportMediaUnreadable`       | A media file of the site cannot be read, or changes while it is written                          |
| `exportArchiveCorrupt`        | A file is missing, extra, of the wrong size or hash, or breaks the layout rules                  |
| `exportFormatUnsupported`     | `format` is not `micelio-site-export`, or `formatVersion` has a major the importer does not know |
| `exportDocumentInvalid`       | A document does not validate against the schema of its type                                      |
| `exportEditorialInconsistent` | An editorial state disagrees with the versions of its document                                   |
| `exportLocaleMissing`         | The archive uses a locale the target does not have                                               |
| `exportSiteSlugTaken`         | Another site of the target has the archive site's `slug`                                         |
| `exportHostTaken`             | Another site of the target has one of the archive site's `hosts`                                 |
| `exportMediaRefused`          | The target's upload provider refuses a media file                                                |

## Versions of the format

`formatVersion` is `major.minor`, and changes by section 6 of the standard:

| Change                                                                                                     | Version                                  |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| A new optional attribute, a new export name, a new optional manifest field                                 | MINOR                                    |
| A renamed or removed export name, attribute or manifest field; a changed serialisation; a new required one | MAJOR, and a breaking change of the core |

- An importer **must** accept an archive with a higher minor of its major: it ignores manifest fields and attributes it does not know, imports the export names it knows and lists the others in its report. This is what lets the previous release import a newer archive.
- An importer **must** refuse an archive whose major it does not know (`exportFormatUnsupported`).
- The core release line in `manifest.micelio` is information for the importer, not a condition: the format version decides.

## Conformance checklist

An exporter conforms to format `1.1` when:

- [ ] It writes one site per archive, with the layout, the manifest and the checksums above.
- [ ] Every content type of the site is written under its export name, as [Content types](#content-types) says, with `documentId`s and no numeric ids.
- [ ] Relations are written on their owning side, as references by export name and `documentId`.
- [ ] Dynamic zone items carry `block` when the component is a block of the catalogue.
- [ ] Media is written once per SHA-256, as the library stores it, with its index entry.
- [ ] Nothing of [What is never exported](#what-is-never-exported) is in the archive, and personal data only with `personal: true`.
- [ ] Two exports of an unchanged site differ only in `exportedAt`.
- [ ] A plugin section is written under `plugins/<id>/` with its manifest entry, and only when it has no personal data or is asked for by `id`.

An importer conforms to format `1.1` when:

- [ ] It checks every size and hash, the layout and every document before it writes anything.
- [ ] It refuses an unknown major and accepts a higher minor, reporting what it skipped.
- [ ] It keeps `documentId`s, rebuilds inverse relations and derived fields, and resolves blocks by `block` first.
- [ ] It imports editorial states and published versions as a restore, without the transition policy or the hooks.
- [ ] It refuses missing locales, taken slugs and taken hosts, and never changes the target's default site.
- [ ] It reuses media by SHA-256 and applies the target's upload rules.
- [ ] It writes the content in one transaction, and a second import of the same archive writes nothing.
