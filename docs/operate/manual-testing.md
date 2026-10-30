# Test the plugin by hand

How to run the plugin in a Strapi, next to the Micelio frontend, on Docker. It is for whoever works on this plugin: a clean Strapi 5 with only this plugin installed (as `test/strapi/app/` is, for the suites), PostgreSQL and the Micelio frontend. It is not a deployment and nothing here is meant for production.

You need Docker with Compose v2, Node 22 (`.nvmrc`) and free ports 1337 and 3000.

## Bring it up

```bash
npm run dev:docker
```

The first run writes `.env.docker` (gitignored) with new throwaway secrets, builds the CMS image (a few minutes: it installs the plugin's dependencies), starts the three services and waits until each is healthy. Then it prints:

| What     | Where                         | Notes                                                                                          |
| -------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Admin    | `http://localhost:1337/admin` | Strapi asks for the first admin's name, email and password on the first visit; use any values. |
| Frontend | `http://localhost:3000`       | The published image `ghcr.io/bogd3v/micelio:edge`, or the one `FRONTEND_IMAGE` names.          |

The seed (`docker/cms/src/index.js`) runs on every boot and is idempotent. It gives the default site the name "Example Site", the host `localhost` and the `url` `http://localhost:3000`, creates a custom API token for the frontend (every `find` and `findOne`, which a read-only token has, plus the two preview routes it needs to exchange preview tokens and read drafts) and another, with only the two preview routes, for trying the preview with `curl`, and creates a draft **Page**, "Open source, in plain words", with a text section and a scene, a heavy island (a one-triangle model) whose poster is its static alternative, and a second one, "A heavy page", over the stack's page budget ([Try the page budget](#try-the-page-budget)). The seed stores the two files' URLs with `CMS_PUBLIC_URL` (`http://localhost:1337`) and the frontend lists it as `NUXT_MEDIA_URL`: the frontend prefixes a relative media URL with `NUXT_PUBLIC_STRAPI_URL`, which is `http://cms:1337` inside Compose and which your browser cannot resolve. `docker/cms/src/api/note/` is a fixture type made with `withSiteScope`, so there is something to preview with `curl`; `docker/cms/src/api/page/` has the shape of the `page` of `micelio-cms`, because the frontend previews `api::page.page` and asks the CMS for every section of the catalogue. `docker/cms/dev.mjs` writes those sections' schemas into `docker/cms/src/components/` (gitignored) from `test/fixtures/micelio-cms-v0.4.0-components.json`. Like the rest of the stack, none of it is the distribution's.

The plugin owns **Category** and **Tag** (`/api/categories` and `/api/tags`, as in `micelio-cms`; the fixture article and the `post-list` section point at them, and `docker/cms/src/extensions/micelio/` adds the inverse `articles` as the distribution does), so the frontend's category requests answer. Until the rest of the content types of `micelio-cms` move into the plugin (the cut-over of release line 0.7) its request for the site settings fails with a 404, and it shows an empty site outside the preview. Its log says so (`docker compose -f compose.dev.yml logs frontend`). Use the admin to see what the plugin does: the **Micelio** status page, the Content Manager and the Content-Type Builder.

The preview needs a frontend that has the preview route (bogd3v/micelio#729). If the `edge` image predates it, build one from the `main` branch of `micelio` and name it: `docker build -t micelio:preview <micelio checkout>`, then `FRONTEND_IMAGE=micelio:preview npm run dev:docker`.

## Try the preview pane

The admin's preview page shows a draft beside its form, rendered by the real frontend. Nothing here is played with `curl`.

1. Bring the stack up with a frontend that has the preview route (above), open `http://localhost:1337/admin` and create the first admin (any values).
2. In Content Manager → Page, open "Open source, in plain words" and copy its `documentId` from the URL. The entry's header has a **Preview** button (an eye): press it, or open `http://localhost:1337/admin/plugins/micelio/preview/api::page.page/<documentId>`. The entry's column is on the left and the frame on the right, showing the draft: the title, the text and the scene (`<micelio-scene>`), inside the frontend's own page.
3. Tick **As static site**: the frame loads again with `mode=static`, and the scene is replaced by its poster, a blue panel (scroll the frame down to it: images load when they come into view). Untick it: the scene is back. While it loads, the old render stays and the two cross-fade.
4. Press **Phone**, **Tablet** and **Desktop**, then Ctrl+Shift+1, 2 and 3: the frame takes 320, 768 and 1280 px, never wider than its column. Ctrl+Shift+S toggles the static site.
5. Press **Open in the Content Manager, in a new tab**, change the title there and **Save**. Within about four seconds, on the preview page's tab, the frame loads the draft again once, with the new title, and the page's own title changes. In the browser's network panel, a document request to `localhost:3000/drafts/pages/…` and none to `/_preview`: the page sent `load-draft`, not a new token.
6. Press **Reload**: the network panel shows `/_preview?token=…` (a new token, 303 to the draft).
7. Turn on reduced motion in your operating system and reload the page: the cross-fade of step 3 is instantaneous.
8. In Settings → Administration Panel → Roles, create a role with **Preview drafts on the frontend** and read permission on Page (all fields, all locales), and no other; invite a user with it and open the page as them: the entry's column says **Read-only**, and the preview shows.
9. Set the language of your profile (the avatar menu → Profile) to Español and reload: the page is in Spanish.
10. In `docker/cms/config/middlewares.js` remove the `frame-src` line, save, wait for Strapi to restart and reload the page: the pane does not show a broken frame; it says the admin does not allow `http://localhost:3000` in a frame and what to change. The **Micelio** status page says the same under the host check, `frame-src for the preview`. Put the line back.
11. The stack's admin (`localhost:1337`) and frontend (`localhost:3000`) are one site to a browser, which ignores ports, so the frame is expected to show in every engine here. To see what WebKit does when the admin and the site are two sites, put the two behind names under different registrable domains with `https` (the cookie is `__Host-`), and set `CMS_PUBLIC_URL`, `FRONTEND_ORIGIN`, `NUXT_PUBLIC_SITE_URL`, `NUXT_PREVIEW_ADMIN_ORIGIN` and `NUXT_MEDIA_URL` in `compose.dev.yml` to match. WebKit then sends no cookie in the frame, which shows the site's 404 page. About 10 seconds after it loads, the pane covers it with **The preview did not start in this browser** and a button, **Open in a new tab**, which is also in the toolbar. Press it: a tab opens on the draft, and the address of the admin's tab never holds a token. Save the entry and reload the tab to see the change; after 15 minutes press the button again.

## Try the preview of an article

The frontend reads an article draft with a `populate` of its cover, author, category, tags, blocks, references and translations (`ARTICLE_POPULATE` in `micelio`). The seed creates a draft article, "A draft article", with a cover and an author, of the fixture `docker/cms/src/api/article/`, which has the shape of the `article` of `micelio-cms`.

1. Create the first admin, as above. In Content Manager → Article, open "A draft article" and copy its `documentId` from the URL.
2. Open `http://localhost:1337/admin/plugins/micelio/preview/api::article.article/<documentId>`. The frame shows the draft in the frontend: the title, the description, the cover image, the author "Ada Example" and the body.
3. The frontend's log (`docker compose -f compose.dev.yml logs frontend`) has no error for the draft.

## Try the page budget

A page with blocks (`page` and `article`, the types the frontend previews) is measured by the frontend when it is published and refused above its budget ([budgets.md](budgets.md)). The stack uses the core's budgets (120 kB for a standard page), measured on the weight of the page's blocks: the framework's script, styles and fonts, about 270 kB on the frontend of `main`, come with every page and are shown apart. The seed creates two draft pages, "Open source, in plain words" (under the budget) and "A heavy page" (over it, with a long text). Two forwards in the stack make the site's `url` and the media URL, which are addresses a browser opens, answer inside the containers too: the CMS reaches the frontend at `http://localhost:3000` and the frontend reaches the CMS's uploads at `http://localhost:1337` (`docker/cms/forward.mjs`).

The stack needs a frontend with the weight route (bogd3v/micelio#730) and its answer to the editor's grant from the admin's origin (bogd3v/micelio#766): `FRONTEND_IMAGE=micelio:preview npm run dev:docker`, with an image built from `main` of `micelio`.

1. Create the first admin, as above. In Content Manager → Page, open "A heavy page" and copy its `documentId` from the URL. Open `http://localhost:1337/admin/plugins/micelio/preview/api::page.page/<documentId>`. The cost meter under the entry reads the weight with the editor's own preview grant, so it needs a frontend whose weight route allows the admin's origin with credentials (see "The cost meter" in [budgets.md](budgets.md)). With one it reads "139.2 kB of 120 kB", says "Over the budget by … kB. This page cannot be published." with a red bar, and **Weight of each block** lists the blocks. The frontend of `main` does not allow it yet: the meter then says the page could not be measured, and **the publish below does not depend on it**.
2. With such a frontend, open the landing's preview the same way: the meter reads about "4.4 kB of 120 kB", the bar is calm, "Every page also sends … kB of framework" and "Loaded only when used" show apart. Press **Measure again** and the time changes.
3. Open the cost line in the edit view: in Content Manager → Page, open "A heavy page". Its side panel **Weight of the blocks** reads "Not measured yet" and the browser's network panel shows no `/_preview?token=…` request: opening the entry renders nothing on the frontend. Press **Measure the page**: it reads "139.2 kB of 120 kB", "Over the budget by 19.2 kB. This page cannot be published.", "Measured <date and time>. Of the saved draft." and a link, **Open the preview**, to the page of step 1. The measurement is one `/_preview?token=…` request, through a frame that is never shown (no frame stays on the page). Open the landing and press it: "4.4 kB of 120 kB" and "Within the budget." Change the landing's title and **Save**: the panel keeps the number and says it is of an earlier save; **Measure again** changes the time.
4. Publishing is a transition: there is no button for it in the admin yet (bogd3v/micelio-plugin-core#57), so log in on the API and publish as the admin route does (the password is the one you chose; nothing is written to a file):

   ```bash
   ADMIN=$(curl -s -X POST localhost:1337/admin/login -H 'Content-Type: application/json' \
     -d '{"email":"<your email>","password":"<your password>"}' | jq -r .data.token)
   PUBLISH() { curl -s -w '\n%{http_code}\n' -X POST localhost:1337/micelio/transitions \
     -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
     -d "{\"uid\":\"api::page.page\",\"documentId\":\"$1\",\"locale\":\"en\",\"to\":\"$2\"}"; }
   PUBLISH <heavy documentId> in_review     # 200
   PUBLISH <heavy documentId> published     # 409 pageOverBudget: blocksKb, frameworkKb, totalKb, budgetKb, overByKb and the blocks
   PUBLISH <landing documentId> in_review   # 200
   PUBLISH <landing documentId> published   # 200, and Content Manager → Page shows it published
   ```

5. Strapi's own **Publish** button in the Content Manager is refused for these pages, with or without a budget: entries are published through the transitions.
6. Point the site at nothing: in Content Manager → Site, set the default site's **url** to `http://localhost:3999` and publish another page (or republish the landing, `PUBLISH <landing documentId> published`): `409 previewUnavailable`, and the page keeps its state. Put `http://localhost:3000` back. (Stopping the frontend does the same, but restart it with `docker compose -f compose.dev.yml restart frontend`, which also restarts the forward that lives in its network.)
7. Raise the budget: in `docker/cms/config/plugins.js` add `config: { budgets: { pageTypes: { standard: 200 } } }` to `micelio`, wait for Strapi to restart and publish the heavy page: `200`.

## Try the block options

The catalogue's presentation options (`contract/options.ts`: `layout`, `width`, `columns`, `density`, `align`, `tone`, `ratio` and `height`) are stored in the block's component and checked when a page is saved. `docker/cms/dev.mjs` adds the ones `micelio-cms` v0.4.0 does not store yet to the sections' schemas it writes, so the Content Manager shows them. A bad value is refused with `blockOptionInvalid`, as a problem detail on the content API.

1. Create the first admin, as above. In Settings → API Tokens create a token of type **Full access** and keep it out of any file: `read -rs TOKEN && export TOKEN` (paste it, press Enter).
2. In Content Manager → Page, create a page, add a **Feature grid** section and open it: next to **Variant** it has **Columns** (2, 3, 4), **Density**; a **Rich text** section has **Width** (prose, wide, full); a **Hero** has **Layout**, **Tone** and **Height**, and no **Columns**.
3. Save with `columns: 3` through the API: it is accepted. (`?status=draft`: a page is editorial, and the content API saves a draft only when asked to.)

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST 'localhost:1337/api/pages?status=draft' \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"data":{"title":"Options","slug":"options","sections":[{"__component":"section.feature-grid","columns":3}]}}'
   # 201
   ```

4. Save with `columns: 6` on the same block: refused, and no page is created.

   ```bash
   curl -s -i -X POST 'localhost:1337/api/pages?status=draft' \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"data":{"title":"Too many","slug":"too-many","sections":[{"__component":"section.feature-grid","columns":6}]}}'
   # HTTP/1.1 400, content-type: application/problem+json
   # "code":"blockOptionInvalid","block":"feature-grid","option":"columns","allowed":["2","3","4"]
   ```

   The Content Manager's own save route answers the same refusal as Strapi's `ValidationError`, with the code in `error.details`.

5. `columns: 6` is for the logo cloud: the same call with `"__component":"section.logo-cloud","columns":6` is `201`. `"__component":"section.cta","align":"end"` is `400` `blockOptionInvalid` with `"allowed":["start","center"]`. `"__component":"section.hero","columns":3` is Strapi's own `400` ("Invalid key columns"): the hero does not expose `columns` and the stack's component does not declare it; the plugin answers `blockOptionInvalid` with `"allowed":[]` where a component declares an option its block does not expose (`npm test` covers it).
6. In Content Manager → Page, open the first page, change **Columns** to 4 and **Save**: it saves.
7. Articles never take `width: full`. Send the same call to `localhost:1337/api/articles?status=draft` with `{"data":{"title":"Wide","blocks":[{"__component":"shared.media","width":"full"}]}}`: `400`, `"block":"media"`, `"option":"width"`, `"allowed":["prose","wide"]`. With `"width":"wide"` it is `201`. A **Rich text** section of a page takes `"width":"full"`.

## Try the preview with curl

To see what the routes do, one by one, play the frontend with `curl`. The seed gives you a custom API token for it, `PREVIEW_API_TOKEN` in `.env.docker`; load it without printing the file. A `.env.docker` written before the preview existed lacks it: run `npm run dev:docker -- down`, delete `.env.docker` and start again.

1. Open `http://localhost:1337/admin` and create the first admin.
2. The seed has set the default site's **url** to `http://localhost:3000`. (Without a `url` the token route answers `previewUnavailable`: clear it in Content Manager → Site to see it.)
3. In Content Manager → Note, create a note with any title; in the **Site** field pick the default site (the form does not preselect it). Copy its `documentId` from the URL.
4. Log in on the API, ask for a preview token and read it from the URL (the password is the one you chose; nothing here is written to a file):

   ```bash
   export PREVIEW_API_TOKEN=$(grep '^PREVIEW_API_TOKEN=' .env.docker | cut -d= -f2)
   ADMIN=$(curl -s -X POST localhost:1337/admin/login -H 'Content-Type: application/json' \
     -d '{"email":"<your email>","password":"<your password>"}' | jq -r .data.token)
   URL=$(curl -s -X POST localhost:1337/micelio/preview/token -H "Authorization: Bearer $ADMIN" \
     -H 'Origin: http://localhost:1337' -H 'Content-Type: application/json' \
     -d '{"uid":"api::note.note","documentId":"<documentId>"}' | jq -r .data.url)
   echo "${URL%%\?*}"          # http://localhost:3000/_preview
   TOKEN=${URL#*token=}
   ```

5. Exchange it once, as the frontend would, and keep the grant:

   ```bash
   EXCHANGE() { curl -s -X POST localhost:1337/api/micelio/preview/exchange \
     -H "Authorization: Bearer $PREVIEW_API_TOKEN" -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN\"}"; }
   ANSWER=$(EXCHANGE)
   echo "$ANSWER" | jq 'del(.data.grant)'
   GRANT=$(echo "$ANSWER" | jq -r .data.grant)
   ```

   It answers `200` with `{ "data": { "grant", "expiresAt", "adminOrigin": "http://localhost:1337", "contentType": "api::note.note", "documentId": …, "locale": null } }`.

6. Run `EXCHANGE` again: `404` with the `code` `previewRefused`. The token is used up.
7. Read the draft by grant: it answers the note, and only that note.

   ```bash
   curl -s "localhost:1337/api/micelio/preview/draft?documentId=<documentId>" \
     -H "Authorization: Bearer $PREVIEW_API_TOKEN" -H "X-Micelio-Preview-Grant: $GRANT" | jq .data.title
   ```

   With the `documentId` of another note the answer is the same `404` `previewRefused`.

8. Log out of the admin (`curl -s -X POST localhost:1337/admin/logout -H "Authorization: Bearer $ADMIN"`) and repeat step 7: `404`. Remove the **url** of the site and repeat step 4 with a new login: `409` `previewUnavailable`.
9. In Settings → Administration Panel → Roles, the **Editor** role shows **Preview drafts on the frontend** under Plugins → Micelio; without it, the editor's request in step 4 gets `403` `previewForbidden`.
10. Look for the token and the grant in the CMS log: `docker compose -f compose.dev.yml logs cms | grep -c "$TOKEN"` prints `0`.

## Try the republish

An edit of a live entry goes online with the transition `published → published` (ADR-0017, amendment of 2026-10-25). `docker/cms/src/api/article/` is a fixture type with the editorial workflow. The Content Manager cannot publish it, so you move it with `POST /micelio/transitions`, and read the content API with the frontend's token (`FRONTEND_API_TOKEN` in `.env.docker`; load it without printing the file).

1. Open `http://localhost:1337/admin` and create the first admin (the Super Admin). In Settings → Administration Panel → Users, invite a second user with the **Author** role and one with the **Editor** role, and set their passwords from the registration links (or use the Super Admin alone and skip step 9).
2. In Content Manager → Article, create an article titled `First`; in the **Site** field pick the default site (the form does not preselect it). Save, and copy its `documentId` from the URL.
3. Publish it the way the workflow does, as the Super Admin:

   ```bash
   export FRONTEND_API_TOKEN=$(grep '^FRONTEND_API_TOKEN=' .env.docker | cut -d= -f2)
   ADMIN=$(curl -s -X POST localhost:1337/admin/login -H 'Content-Type: application/json' \
     -d '{"email":"<your email>","password":"<your password>"}' | jq -r .data.token)
   MOVE() { curl -s -X POST localhost:1337/micelio/transitions -H "Authorization: Bearer $ADMIN" \
     -H 'Content-Type: application/json' -d "{\"uid\":\"api::article.article\",\"documentId\":\"<documentId>\",\"to\":\"$1\"}"; }
   LIVE() { curl -s -o /dev/stdout -w ' [%{http_code}]\n' localhost:1337/api/articles/<documentId> \
     -H "Authorization: Bearer $FRONTEND_API_TOKEN" | jq -c '[.data.title, .data.publishedAt]' 2>/dev/null; }
   MOVE in_review; MOVE published; LIVE
   ```

   `LIVE` answers `"First"` and its `publishedAt`.

4. In Content Manager, change the title to `Second` and save. `LIVE` still answers `"First"`: the edit sits in the draft.
5. In a second terminal, poll the live version: `while true; do curl -s -o /dev/null -w '%{http_code} ' localhost:1337/api/articles/<documentId> -H "Authorization: Bearer $FRONTEND_API_TOKEN"; sleep 0.05; done`. Then, in the first, run `MOVE published`. It answers `from` and `to` both `published`. The poll prints `200` throughout and never `404`.
6. `LIVE` answers `"Second"` and a later `publishedAt`. The editorial `state` of the entry is still `published`; Content Manager shows who published it (you) and who reviewed it (unchanged).
7. Edit the title to `Third` and save. In Content Manager press **Publish** on the entry: it is refused (`403`), and `LIVE` still answers `"Second"`.
8. `MOVE draft` takes the entry down (`published → draft`) and `LIVE` answers `404`; then `MOVE published` answers `409` `editorialTransitionInvalid`: a draft goes through review first, and the republish is only for an entry that is live.
9. Log in as the Author and run `MOVE published` with their token on a live entry: `403` `editorialTransitionForbidden`, and `LIVE` is unchanged. The Editor gets `200`.
10. To remove the transition for a role, set the **editorialPolicy** of the default site (Content Manager → Site) to `{ "published->published": ["strapi-super-admin"] }`: the Editor now gets `403`.

The hooks are covered by the suite only (`test/strapi/hooks.test.ts`); this stack has no plugin that records them.

## Edit the plugin

`server/`, `admin/` and `contract/` are mounted into the `cms` container. A process there rebuilds `dist/` when you save a file and restarts Strapi, which takes about ten seconds; reload the admin afterwards. You never rebuild the image, except when `package.json` or `package-lock.json` change: run `npm run dev:docker` again, which rebuilds it.

## Read the logs

```bash
docker compose -f compose.dev.yml logs -f cms
```

Replace `cms` with `db` or `frontend`. Without a name you get the three.

## Reset

```bash
npm run dev:docker -- down
```

This stops the stack and deletes its volumes, so the database is gone, with the admin account you created. The next `npm run dev:docker` starts from an empty database and seeds again. It keeps `.env.docker`, the image and what Strapi wrote in `docker/cms/` (`database/`, `types/`, `.strapi/`, `public/`; all gitignored). Delete `.env.docker` too to get new secrets.

## Use a local build of the frontend

Build the image from your checkout of `micelio` and name it in `FRONTEND_IMAGE`:

```bash
docker build -t micelio:local ../micelio
FRONTEND_IMAGE=micelio:local npm run dev:docker
```

## When it fails

- `Cannot run docker` or `dependency failed to start`: read the logs of the service the message names.
- A port is taken: stop what uses 1337 or 3000. The stack publishes both on `127.0.0.1` only.
- The CMS container exits right after the build: `docker compose -f compose.dev.yml logs cms` shows Strapi's error; a message about a missing variable means `.env.docker` is old or edited by hand. Delete it and run again.

CI runs the same command and asks both services for an answer (the `compose` job of `ci.yml`).
