# The Strapi project of compose.dev.yml (docker/cms/) next to the plugin, so both resolve one
# node_modules, as test/strapi/app does. The dependencies are installed here; the sources are mounted.
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim

WORKDIR /plugin
COPY package.json package-lock.json ./
# The plugin's own dev dependencies include Strapi and the admin's packages; `pg` is the driver the
# project adds.
# umask 0000: the service runs as the host user (compose.dev.yml), who needs to write dist/ and the caches.
RUN umask 0000 && npm ci --no-audit --no-fund && npm install --no-save --no-audit --no-fund pg@^8 && chmod 777 /plugin

ENV HOME=/tmp
WORKDIR /plugin/docker/cms
EXPOSE 1337
