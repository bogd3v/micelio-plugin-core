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

The seed (`docker/cms/src/index.js`) runs on every boot and is idempotent. It gives the default site the name "Example Site", the host `localhost` and the `url` `http://localhost:3000`, creates a custom API token for the frontend (every `find` and `findOne`, which a read-only token has, plus the two preview routes it needs to exchange preview tokens and read drafts) and another, with only the two preview routes, for trying the preview with `curl`, and creates a draft **Page**, "Open source, in plain words", with a text section and a scene, a heavy island (a one-triangle model) whose poster is its static alternative, a second one, "A heavy page", over the stack's page budget ([Try the page budget](#try-the-page-budget)), and a third, "Islands without their alternative" ([Try the islands](#try-the-islands)). The seed stores the two files' URLs with `CMS_PUBLIC_URL` (`http://localhost:1337`) and the frontend lists it as `NUXT_MEDIA_URL`: the frontend prefixes a relative media URL (what Strapi stores for an upload in the admin, `/uploads/...`) with `NUXT_PUBLIC_STRAPI_URL`, which is `http://localhost:1337` in `compose.dev.yml` so that your browser can resolve it. Inside the frontend's container that address is the container itself; the `media-forward` service shares its network and forwards the port to the `cms` service, so the frontend's own calls reach the CMS too. `docker/cms/src/api/note/` is a fixture type made with `withSiteScope`, so there is something to preview with `curl`; `docker/cms/src/api/page/` has the shape of the `page` of `micelio-cms`, because the frontend previews `api::page.page` and asks the CMS for every section of the catalogue. `docker/cms/dev.mjs` writes those sections' schemas into `docker/cms/src/components/` (gitignored) from `test/fixtures/micelio-cms-v0.4.0-components.json`. Like the rest of the stack, none of it is the distribution's.

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

## Try the builder

The builder composes a page from the palette beside the frontend's own render.
It needs a frontend that speaks phase 2 of the preview protocol (bogd3v/micelio#732),
so use an `edge` image that has it, or build one: see "Use a local build of the frontend".
Without it the page still previews, and the builder shows no outline over it.

1. Bring the stack up and create the first admin, as above.
   In Content Manager → Page, open "Open source, in plain words" and copy its `documentId`.
   Open `http://localhost:1337/admin/plugins/micelio/preview/api::page.page/<documentId>`
   and press **Open in the builder**, or open
   `http://localhost:1337/admin/plugins/micelio/builder/api::page.page/<documentId>` directly.
2. The toolbar shows the title, **Draft**, and the page weight meter.
   The palette lists the blocks of the site's catalogue that the Page type accepts,
   each with its cost, and a blue badge with the kind's icon on the heavy ones.
   Click the search box and type `scene`: the match is in bold and the count reads "1 of N match".
3. Click the "Open source, in plain words" text in the frame: it gets a solid outline,
   a label with its name and position, and up, down and duplicate buttons.
   The panel on the right shows its fields.
   Change the text: the frame shows it as you type, and about a second later the toolbar says
   _Saved_ and the frame loads the draft once.
4. Select a block in **Page blocks** and click **Rich text** in the palette:
   it is inserted after the selection, selected, and saved.
   Press `⌥↑` (`Alt+ArrowUp`) with the new block selected: it moves up in the list and the frame.
5. Drag a row of the palette into the frame: the gaps between blocks appear,
   the one under the pointer says _DROP HERE_ and the frame opens a space there.
   Drop it: the block is inserted at that gap. The dragged card is not tilted.
6. **Remove** the new block, then press **Undo** in the message at the bottom:
   it comes back. Reload the page: the saved state is the one you left.
7. Open the same builder URL in a second tab and change a block's text there.
   In the first tab, change another text: within a few seconds it shows
   _This page was saved somewhere else_, and **Content Manager** shows the second tab's text,
   not the first's. **Load their version** shows theirs.
8. Turn on reduced motion in your operating system and reload:
   the cross-fade after a save and the outline appear at once.
9. Check the Axe result with a block selected (the browser's accessibility tools): no violations.
10. Set the language of your profile to Español and reload: the page is in Spanish.
11. Insert a **Rich text** block and leave its text empty: the toolbar says
    _Not saved: a required field is empty_ and the Content Manager shows no new block.
    Type some text: it saves.
12. A role that may read the page but not edit it (Roles → _Update_ off on Page) opens the
    builder read-only, with a notice, and the palette does nothing.

The builder does not offer **Send to review** until bogd3v/micelio-plugin-core#57.

### Try the keyboard of the builder

Open the builder on "Open source, in plain words", as above, and put the mouse aside.

1. Press `?`: the sheet of keyboard shortcuts opens, in groups, with ⌘ on a Mac and `Ctrl`
   elsewhere. `Esc` closes it and focus returns to where it was.
2. Press `/` and type `scene`; press `Esc`: the search clears. Press `2`, then `↓` and `↑`: the
   selection moves in the list and the frame. `⌘1` focuses the panel, `⌘2` the frame.
3. With a block selected press `Enter`: focus goes to the palette's search. `Tab` to a row and
   press `Enter`: the block is inserted after the selection.
4. Press `⌥↑` and `⌥↓`: the block moves. Press `⌘D`, then `⌘⌫`, then `⌘Z` and `⇧⌘Z`: the copy
   appears, goes, comes back and goes again.
5. Focus a row of **Page blocks** (`Tab`), press `Space`, then `↓` (the sentence under the list is
   read by a screen reader and the row is outlined), then `Space`: the block is in its new place.
   `Esc` instead of the last `Space` puts it back.
6. Select a block that has options (a Feature grid), focus a value of **Columns** and press `→`
   and `←`: the value changes and goes round. Press `⌥⌫`: the options are the defaults.
7. Click in a text field of the panel and press `1`, `/` and `?`: they are typed, nothing else
   happens. `⌘Z` undoes the typing. `Esc` goes up from the field.
8. Press `⌘⇧1`, `⌘⇧2`, `⌘⇧3` and `⌘⇧S`: the width and **As static site** change.
   `⌘S` saves at once. `⌘↵` opens **Send to review** on a draft. `⌘⇧←` goes back to the entry.
9. Compose and publish a page with the keyboard alone: add blocks, fill them, `⌘↵`, `Tab` to
   **Send to review**, `Enter`, then `Tab` to **Publish** and `Enter`.

### Try the media fields of the builder

Open the builder on "Open source, in plain words", as above, with two images at hand to upload.

1. Click **Gallery** in the palette. The panel on the right shows **Images \***, **+ Add files**
   and _A file is required_. The toolbar says _Not saved: a required field is empty_, the block is
   marked _Needs content_ in the list, and the Content Manager's Page shows no gallery.
2. Press **+ Add files**. Strapi's own Media Library opens (the one the Content Manager opens):
   **Add more assets**, upload the two images, select them and press **Finish**. Each file shows
   its thumbnail, name and size, **Replace**, **Remove** and two arrows, and under it **Alternative
   text \*** with _Required by the accessibility check_ and **Decorative, no text needed**.
   About a second later the toolbar says _Saved_, and the frame shows both images.
3. Press the down arrow of the first image: the order changes in the panel and, after the save,
   in the frame. Press **Remove** on one: it goes from the panel and the frame. In the Content
   Manager the gallery holds the one that is left.
4. Type a text in **Alternative text** and leave the field: the frame shows it as the image's
   `alt` after the save, and the Media Library (Media Library → the file → Alternative text) holds
   the same text. Tick **Decorative, no text needed** on the other: the field is disabled and the
   Media Library's text for that file is empty.
5. Press **Replace** on the image that is left and pick another file: it is replaced, the block's
   other fields stay, and the message says _Files changed_. Press **Undo**: the first file is back,
   and the frame shows it after the save.
6. Select a **Feature grid**, add an item and open it: if its component has an **Icon**, it shows
   **Choose a file**. Pick a file, press **Replace**, pick another, then **Undo**: the item keeps
   its title and its place.
7. Open the same builder in a second tab and save a change there. In the first, change the
   gallery's order and press **Keep my version**: the images are still the ones you left.
8. Turn on reduced motion and set the language to Español, and reload: the labels are in Spanish.

## Try the islands

The seed adds a draft page, "Islands without their alternative": a text section, a Scene with no
poster and a Playground with no expected output. The commands run on the stack of
`npm run dev:docker` (first admin created, as above).

1. In Content Manager → Page, open "Islands without their alternative" and copy its `documentId`.
   Open `http://localhost:1337/admin/plugins/micelio/builder/api::page.page/<documentId>`.
2. In the palette, **Scene** and **Playground** each have a blue badge: a cube for the Scene
   (3D) and `</>` for the Playground (runtime). The two rows of **Page blocks** carry the same
   badge. Hover a badge: its title says the kind, how it loads and what it weighs
   ("3D island · in view · 151.3 kB").
3. In the frame, the Scene carries its icon in its corner. Hover it: the icon grows into
   "3D · in view · 151.3 kB" and the outline turns dashed blue. The frontend must speak phase 2
   (`micelio:blocks`) for the outline to show.
4. Click the Scene. The label reads "Scene · 3D island · 2 of 3" and has a **static** button; the
   panel shows the badge, "What this costs the visitor" and **Poster \***, with
   **Choose a file** (the Media Library, as in the media steps above) and "The static alternative.
   Required before the page goes to review." The poster does not hold the save: the toolbar says
   _Saved_ with the poster empty. Pick one and the note changes to "The static alternative, shown
   before the island loads and on the static site."
5. Click **static**: the button reads as pressed, and the badge in the corner says "3D → poster"
   once you select another block. The frame changes only when the frontend handles the message
   (bogd3v/micelio#735). To see the message, open the browser's console on the admin tab, pick the
   preview frame in the console's context menu, and run this before you click:

   ```js
   addEventListener('message', (event) => {
     if (event.data?.type === 'micelio:renderMode') console.log(event.data.payload)
   })
   ```

   It logs `{ address: { zone: 'sections', index: 1, block: 'scene', version }, mode: 'static' }`.
   Click **static** again: `mode: 'dynamic'`.

6. Select the Playground. **Expected output \*** is marked required and says so. **Run here and
   fill expected output** is disabled, with its reason.
7. Send the page to review as the admin route does (the password is the one you chose; nothing is
   written to a file):

   ```bash
   ADMIN=$(curl -s -X POST localhost:1337/admin/login -H 'Content-Type: application/json' \
     -d '{"email":"<your email>","password":"<your password>"}' | jq -r .data.token)
   curl -s -w '\n%{http_code}\n' -X POST localhost:1337/micelio/transitions \
     -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
     -d '{"uid":"api::page.page","documentId":"<documentId>","locale":"en","to":"in_review"}'
   ```

   The answer is `409` with `"code": "islandAlternativeMissing"` and `blocks` naming the Scene
   (`poster`) and the Playground (`expectedOutput`). The page is still a draft.

8. In Content Manager, choose a poster for the Scene and write an expected output for the
   Playground, run the command again: `200`.
9. Two background Scenes: in the builder, insert a second **Scene** and set both to _Background_.
   The save is refused with _The page was not saved_ and the detail "A page may hold 1 scene
   block with variant background, and this one has 2". Set one back to _Inline_: it saves.

## Try the page settings

The builder's **Page settings** drawer sets a page's slug, its type and where it shows up, and
lists the redirects a changed slug leaves behind ([docs/guide/pages.md](../guide/pages.md)).
`docker/cms` applies `withPageSettings` to its `page` type. Publishing is a transition with no
button yet (bogd3v/micelio-plugin-core#57), so the steps publish through the admin route.

1. Bring the stack up and create the first admin with the email `admin@example.com` and the
   password `Password1234` (a throwaway stack). Log in on the API and find the two seeded pages:

   ```bash
   ADMIN=$(curl -s -X POST localhost:1337/admin/login -H 'Content-Type: application/json' \
     -d '{"email":"admin@example.com","password":"Password1234"}' | jq -r .data.token)
   idof() { curl -s -g -H "Authorization: Bearer $ADMIN" \
     "localhost:1337/content-manager/collection-types/api::page.page?filters[slug][\$eq]=$1" \
     | jq -r '.results[0].documentId'; }
   LANDING=$(idof landing); HEAVY=$(idof heavy)
   PUBLISH() { curl -s -w '\n%{http_code}\n' -X POST localhost:1337/micelio/transitions \
     -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
     -d "{\"uid\":\"api::page.page\",\"documentId\":\"$1\",\"locale\":\"en\",\"to\":\"$2\"}"; }
   PUBLISH "$LANDING" in_review    # 200
   PUBLISH "$LANDING" published    # 200: the page is live as /landing
   echo "http://localhost:1337/admin/plugins/micelio/builder/api::page.page/$LANDING"
   ```

2. Open the address the last command printed. Next to the title there is a gear. Press it, or
   press `Ctrl+,`: the **Page settings** drawer opens over the builder with the preview still
   in view, and the cursor is in **Slug**. The slug is `landing`, the text under it says
   _Published as /landing_, **Page type** has Landing, Standard and Long read with Standard
   chosen and "Standard: 120 kB" under it, and **Visibility** has the menu and sitemap boxes on.
   **Esc** shuts it and the gear has the focus again.
3. In the drawer change **Slug** to `open-source` and press `Tab`. The drawer says _Saved_ and the
   text under the slug says _Published before as /landing_. A draft's slug changes no address, so
   there is no redirect yet:

   ```bash
   curl -s -H "Authorization: Bearer $ADMIN" \
     localhost:1337/content-manager/collection-types/plugin::micelio.redirect | jq .pagination.total
   # 0
   ```

4. Publish again. The redirect is written in the same transaction as the publish:

   ```bash
   PUBLISH "$LANDING" published    # 200
   curl -s -H "Authorization: Bearer $ADMIN" \
     localhost:1337/content-manager/collection-types/plugin::micelio.redirect \
     | jq -c '.results[] | {from, to, entryLocale}'
   # {"from":"/landing","to":"/open-source","entryLocale":"en"}
   ```

5. The frontend's list, with its `ETag`. In Settings → API Tokens create a token of type
   **Full access**; type it at the prompt (nothing is echoed) and keep it out of any file:

   ```bash
   read -rs TOKEN && export TOKEN
   curl -si -H "Authorization: Bearer $TOKEN" 'localhost:1337/api/micelio/redirects?site=default'
   # 200, an ETag header, Cache-Control: public, max-age=60 and
   # {"data":[{"from":"/landing","to":"/open-source","locale":"en"}]}
   ETAG=$(curl -si -H "Authorization: Bearer $TOKEN" \
     'localhost:1337/api/micelio/redirects?site=default' \
     | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
   curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
     -H "If-None-Match: $ETAG" 'localhost:1337/api/micelio/redirects?site=default'
   # 304
   ```

6. Reload the builder and open the drawer: **Redirects to /open-source** lists
   `/landing → /open-source`. Press **Remove**: the line goes, the drawer says
   _No redirects yet_, and the list of step 4 has a total of 0 again.
7. **Page type** and the budget. Open the builder of the heavy page
   (`http://localhost:1337/admin/plugins/micelio/builder/api::page.page/` and `$HEAVY`, as in
   step 1's last command) and open its drawer. Press **Landing**: the drawer says _Saved_, the
   text under the buttons reads "Landing: 60 kB", the page weight meter in the toolbar measures
   the page again against 60 kB and the palette dims the blocks Landing does not allow. The
   page saved though it is over budget. Publishing is what is refused:

   ```bash
   PUBLISH "$HEAVY" in_review      # 200
   PUBLISH "$HEAVY" published      # 409 pageOverBudget, "pageType":"landing","budgetKb":60
   ```

8. Tick **Hidden from search engines** and clear **In the navigation menu**, reload the page and
   open the drawer: both stay as you left them.
9. Set the language of your profile to Español and reload: the drawer is in Spanish.
   Set the theme to dark (Profile → Interface mode): the drawer reads in Strapi's dark colours.
10. A role that may read the page but not edit it opens the drawer with every control disabled.

## Try page templates

A page is saved as a template from the builder's **Page settings** drawer and a new page is made
from one in the gallery ([docs/guide/templates.md](../guide/templates.md)). The steps publish
through the admin route, as the page settings do.

1. Bring the stack up (`npm run dev:docker`, `docker compose -f compose.dev.yml build cms` first
   if the image predates this branch) and create the first admin with the email
   `admin@example.com` and the password `Password1234` (a throwaway stack). Then make a page of
   four blocks, which is what the steps save as a template:

   ```bash
   ADMIN=$(curl -s -X POST localhost:1337/admin/login -H 'Content-Type: application/json' \
     -d '{"email":"admin@example.com","password":"Password1234"}' | jq -r .data.token)
   SITE=$(curl -s -g -H "Authorization: Bearer $ADMIN" \
     'localhost:1337/content-manager/collection-types/plugin::micelio.site' \
     | jq -r '.results[0].documentId')
   PAGEBODY='{"title":"What open source is","slug":"what-open-source-is","pageType":"landing",
   "site":"'$SITE'","sections":[
   {"__component":"section.hero","title":"Software you can read","text":"A plain-words guide.",
   "variant":"split"},
   {"__component":"section.feature-grid","title":"Why it matters","variant":"grid","columns":"3",
   "items":[{"title":"Readable","text":"Anyone can read it."},
   {"title":"Changeable","text":"Anyone can fix it."},
   {"title":"Shareable","text":"Anyone can pass it on."}]},
   {"__component":"section.rich-text","body":"Open source means open to everyone.","width":"prose"},
   {"__component":"section.cta","title":"Try it","text":"Start with one page.",
   "variant":"banner"}]}'
   EXPLAINER=$(curl -s -g -X POST \
     'localhost:1337/content-manager/collection-types/api::page.page?plugins[i18n][locale]=en' \
     -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "$PAGEBODY" \
     | jq -r .data.documentId)
   echo "http://localhost:1337/admin/plugins/micelio/builder/api::page.page/$EXPLAINER"
   ```

2. Open the address the last command printed, press the gear and then **Save as template…** in
   the footer of the drawer. The dialog says "From “What open source is” · 4 blocks · 7.6 kB" and
   lists Hero, Feature grid, Rich text and Cta with their options. Type the name `Explainer
landing`, leave **For page types** on Landing, choose **Clear** for Rich text and tick
   **Fixed** for Hero. The checks read: every option is one the catalogue offers; 7.6 kB of 60 kB
   landing budget (before content); no island; every block is enabled on default; the name is
   unique. Press **Save template**: a notification says it is saved. The server holds it:

   ```bash
   curl -s -H "Authorization: Bearer $ADMIN" \
     'localhost:1337/micelio/templates?site=default&uid=api::page.page' \
     | jq -c '.data[] | {name, version, scope, kb, blocks: [.blocks[] | {block, content, fixed}]}'
   # {"name":"Explainer landing","version":1,"scope":"site","kb":7.6,"blocks":[
   #   {"block":"hero","content":"sample","fixed":true},
   #   {"block":"feature-grid","content":"sample","fixed":false},
   #   {"block":"rich-text","content":"clear","fixed":false},
   #   {"block":"cta","content":"sample","fixed":false}]}
   ```

3. Open the dialog again and type the same name: the last check turns red, "A template named …
   exists on default", and **Save template** answers with that text. Nothing is stored.
4. In Content Manager → Page press **Create new entry**. The header has an icon, **New page from
   a template…** (the Micelio mark, left of the three dots). Press it and, as Strapi asks
   whether to leave the form, **Confirm**: **New page** opens with the template's card,
   Explainer landing, selected, with its blocks, its 7.6 kB and its
   thumbnail drawn from the structure; and **Empty page**. Type `Open source, explained` in
   **Title of the new page** and press **Create from Explainer landing**. The builder opens on a
   draft with the four blocks. Click the Hero: its Title and Text are grey and italic and say
   "Sample text from the template: replace it before you publish." The Rich text says _Needs
   content_: it was cleared. The page records its template:

   ```bash
   PAGES='localhost:1337/content-manager/collection-types/api::page.page'
   curl -s -g -H "Authorization: Bearer $ADMIN" \
     "$PAGES?filters[slug][\$eq]=open-source-explained" \
     | jq -c '.results[0] | {pageType, templateId, templateVersion}'
   # {"pageType":"landing","templateId":"<the template's id>","templateVersion":1}
   ```

5. Sample text keeps the page from publishing. Review is allowed; publishing is not:

   ```bash
   NEW=$(curl -s -g -H "Authorization: Bearer $ADMIN" \
     "$PAGES?filters[slug][\$eq]=open-source-explained" | jq -r '.results[0].documentId')
   PUBLISH() { curl -s -w '\n%{http_code}\n' -X POST localhost:1337/micelio/transitions \
     -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
     -d "{\"uid\":\"api::page.page\",\"documentId\":\"$1\",\"locale\":\"en\",\"to\":\"$2\"}"; }
   PUBLISH "$NEW" in_review    # 200
   PUBLISH "$NEW" published    # 409 sampleTextPresent, "blocks" naming hero, feature-grid, cta
   ```

   In the builder replace the texts the refusal names (the Hero's title and text, the Feature
   grid's title and the title and text of each item, the Cta's title and text) and write a text
   in Rich text. Publish again after each save: the refusal lists what is left, and when nothing
   is, the answer is `200`.

6. A template that cannot be CMS-wide. Make a second site, and turn the Cta off there:

   ```bash
   curl -s -X POST 'localhost:1337/content-manager/collection-types/plugin::micelio.site' \
     -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
     -d '{"name":"Other","slug":"other","hosts":["other.localhost"],"modules":{}}' \
     | jq -c .data.slug
   ```

   In **Micelio → Block catalogue** choose the site Other and switch **Cta** off. Open the
   builder of step 2, press **Save as template…**, type `Everywhere` and choose **Every site of
   this CMS**: the scope check turns red, "The cta block is disabled on other", and **Save
   template** answers with it. **Other** names the site; scoping it to the default site only
   saves it. Switch the Cta back on.

7. Export and import, in the gallery and on the command line. In **New page**, press **Export
   JSON** on Explainer landing: the browser saves `explainer-landing.micelio-template.json`. On
   the command line (the stack's Strapi project is the container's working folder):

   ```bash
   docker compose -f compose.dev.yml exec cms node /plugin/bin/micelio.js template export \
     'Explainer landing' --site default --output /tmp/explainer.json
   # /tmp/explainer.json
   docker compose -f compose.dev.yml exec cms node /plugin/bin/micelio.js template import \
     /tmp/explainer.json --site default
   # exit 1: templateNameTaken, the site has that name
   docker compose -f compose.dev.yml exec cms node /plugin/bin/micelio.js template import \
     /tmp/explainer.json --site other
   # Explainer landing (<id>), version 1.
   ```

   In **New page**, choose the site Other: the template is there. **Import a template** with the
   downloaded file on the site Other is refused the same way, as a notification.

8. Set the language of your profile to Español and reload: the dialog and the gallery are in
   Spanish. Set the theme to dark (Profile → Interface mode): both read in Strapi's dark colours.
9. A role without **Manage the page templates of a site** and with permission to create Page opens
   the drawer without **Save as template…** and the gallery without **Export JSON** and **Import a
   template**; it still lists the templates and creates a page from one.

10. Manage templates and the Template tab (#55). Open **Micelio → Page templates**: Explainer
    landing is listed with its blocks, source and "1 page" or more (the pages of step 4). Select it:
    the panel lists those pages with `v1 · draft`. Press **Edit in builder**: the builder opens
    with the notice "No preview here" and no frame. Select the Rich text, tick **Fixed**, press
    **Save as v2**; back on the list the history shows "v2 · … Rich text: now fixed".
11. In the builder of the page of step 4 open the gear and the **Template** tab: it says the
    template is now at v2 and lists "Rich text: now fixed". Nothing changed on the page yet. Press
    **Apply the structure changes**: the tab reads "up to date" and the Rich text is fixed (in
    the builder its remove and move controls are disabled). Press **Detach from template**: the
    lock is gone and the tab says the page was made without a template. In **Page templates**
    press **Retire** on Explainer landing: **New page** no longer lists it; **Restore** brings it
    back. **Duplicate** adds "Explainer landing (copy)".

## Try the preview of an article

The frontend reads an article draft with a `populate` of its cover, author, category, tags, blocks, references and translations (`ARTICLE_POPULATE` in `micelio`). The seed creates a draft article, "A draft article", with a cover and an author, of the fixture `docker/cms/src/api/article/`, which has the shape of the `article` of `micelio-cms`.

1. Create the first admin, as above. In Content Manager → Article, open "A draft article" and copy its `documentId` from the URL.
2. Open `http://localhost:1337/admin/plugins/micelio/preview/api::article.article/<documentId>`. The frame shows the draft in the frontend: the title, the description, the cover image, the author "Ada Example" and the body.
3. The frontend's log (`docker compose -f compose.dev.yml logs frontend`) has no error for the draft.

## Try the page budget

A page with blocks (`page` and `article`, the types the frontend previews) is measured by the frontend when it is published and refused above its budget ([budgets.md](budgets.md)). The stack uses the core's budgets (120 kB for a standard page), measured on the weight of the page's blocks: the framework's script, styles and fonts, about 270 kB on the frontend of `main`, come with every page and are shown apart. The seed creates two draft pages, "Open source, in plain words" (under the budget) and "A heavy page" (over it, with a long text). Two forwards in the stack make the site's `url` and the media URL, which are addresses a browser opens, answer inside the containers too: the CMS reaches the frontend at `http://localhost:3000` and the frontend reaches the CMS's uploads at `http://localhost:1337` (`docker/cms/forward.mjs`).

The stack needs a frontend with the weight route (bogd3v/micelio#730) and its answer to the editor's grant from the admin's origin (bogd3v/micelio#766): `FRONTEND_IMAGE=micelio:preview npm run dev:docker`, with an image built from `main` of `micelio`.

1. Create the first admin, as above. In Content Manager → Page, open "A heavy page" and copy its `documentId` from the URL. Open `http://localhost:1337/admin/plugins/micelio/preview/api::page.page/<documentId>`. The cost meter under the entry reads the weight with the editor's own preview grant, so it needs a frontend whose weight route allows the admin's origin with credentials (see "The cost meter" in [budgets.md](budgets.md)). With one it reads "139.2 kB of 120.0 kB", says "Over the budget by … kB. This page cannot be published." with a red bar, and **Weight of each block** lists the blocks. The frontend of `main` does not allow it yet: the meter then says the page could not be measured, and **the publish below does not depend on it**.
2. With such a frontend, open the landing's preview the same way: the meter reads about "4.4 kB of 120.0 kB", the bar is calm, "Every page also sends … kB of framework" and "Loaded only when used" show apart. Press **Measure again** and the time changes.
3. Open the cost line in the edit view: in Content Manager → Page, open "A heavy page". Its side panel **Weight of the blocks** reads "Not measured yet" and the browser's network panel shows no `/_preview?token=…` request: opening the entry renders nothing on the frontend. Press **Measure the page**: it reads "139.2 kB of 120.0 kB", "Over the budget by 19.2 kB. This page cannot be published.", "Measured <date and time>. Of the saved draft." and a link, **Open the preview**, to the page of step 1. The measurement is one `/_preview?token=…` request, through a frame that is never shown (no frame stays on the page). Open the landing and press it: "4.4 kB of 120.0 kB" and "Within the budget." Change the landing's title and **Save**: the panel keeps the number and says it is of an earlier save; **Measure again** changes the time.
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

## Try the block catalogue

**Micelio → Block catalogue** (`http://localhost:1337/admin/plugins/micelio/blocks`) is where a site
enables and configures the blocks of the catalogue ([block-catalogue.md](block-catalogue.md)). The
stack's `page` is site-scoped and holds every block, so it shows what the page does.

1. Create the first admin, as above. In Settings → API Tokens create a **Full access** token and
   keep it out of any file: `read -rs TOKEN && export TOKEN` (paste it, press Enter). Log in on the
   API for the admin routes (the password is the one you chose):

   ```bash
   ADMIN=$(curl -s -X POST localhost:1337/admin/login -H 'Content-Type: application/json' \
     -d '{"email":"<your email>","password":"<your password>"}' | jq -r .data.token)
   PALETTE() { curl -s "localhost:1337/micelio/blocks?site=default" -H "Authorization: Bearer $ADMIN" \
     | jq -c '[.data[].id]'; }
   NEW() { curl -s -w '\n%{http_code}\n' -X POST 'localhost:1337/api/pages?status=draft' \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d "{\"data\":{\"title\":\"$1\",\"slug\":\"$1\",\"sections\":[$2]}}"; }
   ```

2. Open the page. The table lists the 19 blocks of the catalogue, all on, and the line above it
   reads "0 disabled on default · 19 enabled". `PALETTE` lists 19 ids, `hero` among them.
3. Switch **Hero** off. The row turns grey and the line reads "1 disabled on default · 18
   enabled". `PALETTE` lists 18 ids and no `hero`. **Disabled only** leaves that one row.
4. Try to add the disabled block:

   ```bash
   NEW hero-page '{"__component":"section.hero","title":"Hi","variant":"centered"}'
   # 400, "code":"blockNotAllowed","block":"hero","reason":"disabled"; no page is created
   NEW cta-page '{"__component":"section.cta","title":"Hi","variant":"banner"}'
   # 201: the other blocks still insert
   ```

5. Pages that already use a block keep rendering. Switch **Scene** off, then open the preview of
   "Open source, in plain words" (Content Manager → Page, its **Preview** button): the scene is
   still there. Change that page's title and **Save**: it saves. Switch **Scene** on again.
6. Press **Feature grid**. The drawer lists Landing, Standard and Long read ("core default: yes"),
   a choice for `variant`, `columns` (2, 3 and 4: **no 6**) and `density`, the labels, **Cost**
   and the pages that use the block. Choose `columns` **2**, type "Grid of features" as the English
   label and **Save**: the row shows the label, and the merged view reads `"default":"2"` and
   `"coreDefault":"3"` for it:

   ```bash
   curl -s "localhost:1337/micelio/blocks?site=default" -H "Authorization: Bearer $ADMIN" \
     | jq '.data[] | select(.id=="feature-grid") | {label, columns: .options.columns}'
   ```

7. A default outside the contract is refused by the API too:

   ```bash
   curl -s -w '\n%{http_code}\n' -X PUT "localhost:1337/micelio/block-settings/feature-grid?site=default" \
     -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
     -d '{"defaultOptions":{"columns":6}}'
   # 400, "code":"blockOptionInvalid","block":"feature-grid","option":"columns","allowed":["2","3","4"]
   ```

8. In the drawer untick **Standard** and **Save**. Every page of the stack is a standard page, so
   `NEW grid-page '{"__component":"section.feature-grid","variant":"grid"}'` is
   `400` with `"code":"blockNotAllowed","reason":"pageType","pageType":"standard"`. **Reset to
   core defaults** brings it back.
9. **Measure again** (needs a frontend with the weight route, as in
   [Try the page budget](#try-the-page-budget)): open **Scene**. The drawer reads "Declared 1.9 kB."
   and nothing was asked of the frontend: in the browser's network panel there is no
   `/_preview?token=…` and no `/api/preview/…/weight` request. Press **Measure again**: one
   `/_preview?token=…` request through a frame that is not shown, then the weight request, and
   the line reads "Declared 1.9 kB · measured now … kB on Open source, in plain words (…)".
10. In Settings → Administration Panel → Roles create a role with **Read the block catalogue of a
    site** only; invite a user with it and open the page as them: the switches are disabled and
    the drawer has no **Save**. Give the role **Manage the block catalogue of a site** and the
    switches work.
11. Set the language of your profile to Español and reload: the page, the drawer and the counts
    are in Spanish.

## Try export and import

The plugin's **Export and import** and **About Micelio** pages, in the admin at `http://localhost:1337/admin/plugins/micelio/_export-import` and `.../about`.

1. In **Content Manager → Site**, create a second site: name `Second`, slug `second`, `modules` all off. Leave the hosts empty.
2. Open **Micelio → Export and import**. With the site **Example Site (default)** chosen, leave the four checkboxes on and press **Prepare the export**. The row under **Previous exports** goes from _Waiting_ to a **Download** button; press it and keep the `.micelio.tar.gz`.
3. Choose the site **Second**. Under **Import into Second** choose the file. The page shows **Dry run · nothing written yet**: with the default policy _Skip_ it says that the file's entries belong to another site of this CMS, and _Import_ is disabled. Choose **Keep both**: the table lists, per kind, how many entries are in the file and how many would be created, updated and skipped. Nothing is written yet (check the **Second** site's entries in the Content Manager: none).
4. Press **Import n items**. The report under **Import report** repeats the table's _Create_ figures as _created_. The entries are now in **Second**, and **Example Site** keeps its own.
5. Choose the same file again with **Keep both**: the dry run says _Skip_ for every kind and _Import_ is disabled (`0 items`): importing twice changes nothing.
6. Try **Update** on **Example Site**: choose the file for it; the entries it already has show under _Update_ or _Skip_.
7. Open **Micelio → About Micelio**: versions, the connected frontend with _OK_, the diagnostics block and **Copy diagnostics**. Paste the clipboard anywhere: it holds versions and counts, no email, token or content.
8. The update check: `docker compose -f compose.dev.yml logs cms` shows no line for it; to see what leaves the CMS, run the stack with `MICELIO_UPDATE_CHECK=false npm run dev:docker` and press **Run checks again**: the _Update available_ row says the check is off, and `docker compose -f compose.dev.yml exec cms sh -c 'ss -tn | grep -c :443'` stays at `0` (the only other connection is to the frontend, on port 8080). With the default, the row says whether the release feed answered.

## Try the redirects in an archive

The redirects of a site travel in its archive (`redirects.json`,
[export format](../export-format.md#redirects)). This starts from the stack as it is, whatever
the sections above left in it.

1. In **Content Manager → Site**, create a third site: name `Third`, slug `third`, `modules` all
   off, no hosts.
2. In **Content Manager → Redirect**, create three entries (they have no draft, so **Save** is
   enough): `from` `/old-a`, `to` `/new-a`, `entryLocale` `en`, `site` Example Site; `from`
   `/old-b`, `to` `/new-b`, `entryLocale` `en`, `site` Example Site; and `from` `/old-a`, `to`
   `/mine`, `entryLocale` `en`, `site` Third.
3. Open **Micelio → Export and import**. With **Example Site (default)** chosen, press **Prepare
   the export** and **Download** the file, as in the section above.
4. Choose the site **Third**, choose the file under **Import into Third**, choose **Keep both**
   and press **Import n items**.
5. Read the redirects of **Third** from the content API. In Settings → API Tokens create a token
   of type **Full access**; type it at the prompt (nothing is echoed) and keep it out of any file:

   ```bash
   read -rs TOKEN && export TOKEN
   curl -s -H "Authorization: Bearer $TOKEN" 'localhost:1337/api/micelio/redirects?site=third' \
     | jq -c '.data[] | {from, to, locale}'
   # {"from":"/old-a","to":"/mine","locale":"en"}
   # {"from":"/old-b","to":"/new-b","locale":"en"}
   ```

   `/old-b` came with the archive. `/old-a` kept the target `/mine` that **Third** had: a
   redirect whose address the site already redirects is not overwritten.

6. Example Site keeps its own two:

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" 'localhost:1337/api/micelio/redirects?site=default' \
     | jq -c '.data[] | {from, to, locale}'
   # {"from":"/old-a","to":"/new-a","locale":"en"}
   # {"from":"/old-b","to":"/new-b","locale":"en"}
   ```

   (The list may hold more if you ran [the page settings](#try-the-page-settings) before.) A
   redirect that leaves the site is skipped and reported by the import; the suite
   `test/strapi/site-redirects.test.ts` covers it, because the page does not write an archive
   with one.

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
