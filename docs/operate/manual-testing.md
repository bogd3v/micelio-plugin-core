# Test the plugin by hand

How to run the plugin in a Strapi, next to the Micelio frontend, on Docker. It is for whoever works on this plugin: a clean Strapi 5 with only this plugin installed (as `test/strapi/app/` is, for the suites), PostgreSQL and the published frontend. It is not a deployment and nothing here is meant for production.

You need Docker with Compose v2, Node 22 (`.nvmrc`) and free ports 1337 and 3000.

## Bring it up

```bash
npm run dev:docker
```

The first run writes `.env.docker` (gitignored) with new throwaway secrets, builds the CMS image (a few minutes: it installs the plugin's dependencies), starts the three services and waits until each is healthy. Then it prints:

| What     | Where                         | Notes                                                                                          |
| -------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Admin    | `http://localhost:1337/admin` | Strapi asks for the first admin's name, email and password on the first visit; use any values. |
| Frontend | `http://localhost:3000`       | The published image `ghcr.io/bogd3v/micelio:edge`.                                             |

The seed (`docker/cms/src/index.js`) runs on every boot and is idempotent. It gives the default site the name "Example Site" and the host `localhost`, and creates a read-only API token for the frontend. Nothing else is created: no content, and no content type of `micelio-cms`. `docker/cms/src/api/note/` is a fixture type made with `withSiteScope`, so there is something to preview.

The frontend answers, but until the content types of `micelio-cms` move into the plugin (the cut-over of release line 0.7) its requests for the site settings and the categories fail with a 404, and it shows an empty site. Its log says so (`docker compose -f compose.dev.yml logs frontend`). Use the admin to see what the plugin does: the **Micelio** status page, the Content Manager and the Content-Type Builder.

## Try the preview

The frontend image does not exchange preview tokens yet (bogd3v/micelio#729), so you play the frontend with `curl`. The seed gives you a custom API token for it, `PREVIEW_API_TOKEN` in `.env.docker`; load it without printing the file. A `.env.docker` written before the preview existed lacks it: run `npm run dev:docker -- down`, delete `.env.docker` and start again.

1. Open `http://localhost:1337/admin` and create the first admin.
2. In Content Manager → Site, open the default site and set **url** to `http://localhost:3000`. Save. (Without a `url` the token route answers `previewUnavailable`.)
3. In Content Manager → Note, create a note with any title; the site is the default one. Copy its `documentId` from the URL.
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

An edit of a live entry goes online with the transition `published → published` (ADR-0017, amendment of 2026-10-25). `docker/cms/src/api/article/` is a fixture type with the editorial workflow. The Content Manager cannot publish it, so you move it with `POST /micelio/transitions`, and read the content API with the frontend's read-only token (`FRONTEND_API_TOKEN` in `.env.docker`; load it without printing the file).

1. Open `http://localhost:1337/admin` and create the first admin (the Super Admin). In Settings → Administration Panel → Users, invite a second user with the **Author** role and one with the **Editor** role, and set their passwords from the registration links (or use the Super Admin alone and skip step 9).
2. In Content Manager → Article, create an article titled `First`; the site is the default one. Save, and copy its `documentId` from the URL.
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
