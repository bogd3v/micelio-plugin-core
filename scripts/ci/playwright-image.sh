#!/usr/bin/env bash
# Resolves the Playwright image the browser jobs of CI run in: the tag that matches the lockfile's `playwright-core`, pinned by the
# digest the tag points at now, so a Dependabot bump of @playwright/test moves the image with it and every job of one run gets the same
# bytes. Browsers and their system libraries come preinstalled: no apt and no browser download on the runner (#463).
# Prints `version=<x.y.z>` and `image=mcr.microsoft.com/playwright:v<x.y.z>-noble@sha256:…` on stdout, the form `$GITHUB_OUTPUT` takes.
set -euo pipefail

repository="mcr.microsoft.com/playwright"
lockfile="${1:-package-lock.json}"

version="$(node -p "require('./${lockfile}').packages['node_modules/playwright-core'].version")"
if ! echo "${version}" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "::error::playwright-image: no playwright-core version in ${lockfile} (read '${version}')" >&2
  exit 1
fi
tag="v${version}-noble"

# A HEAD of the manifest answers the digest without pulling. The index (multi-arch) is what `docker pull <tag>` resolves to.
# Bounded and retried: a registry hiccup fails this job in seconds, not the browser jobs after their pull.
accept='application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json'
headers="$(curl --fail --silent --show-error --head --max-time 20 --retry 3 \
  --header "Accept: ${accept}" "https://${repository%%/*}/v2/${repository#*/}/manifests/${tag}")" || headers=""
digest="$(echo "${headers}" | tr -d '\r' | sed -n 's/^docker-content-digest: *//Ip')"
if ! echo "${digest}" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
  echo "::error::playwright-image: no digest for ${repository}:${tag} (does the tag exist for this Playwright version?)" >&2
  exit 1
fi

echo "version=${version}"
echo "image=${repository}:${tag}@${digest}"
