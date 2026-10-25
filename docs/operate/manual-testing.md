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

The seed (`docker/cms/src/index.js`) runs on every boot and is idempotent. It gives the default site the name "Example Site" and the host `localhost`, and creates a read-only API token for the frontend. Nothing else is created: no content, and no content type of `micelio-cms`.

The frontend answers, but until the content types of `micelio-cms` move into the plugin (the cut-over of release line 0.7) its requests for the site settings and the categories fail with a 404, and it shows an empty site. Its log says so (`docker compose -f compose.dev.yml logs frontend`). Use the admin to see what the plugin does: the **Micelio** status page, the Content Manager and the Content-Type Builder.

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
