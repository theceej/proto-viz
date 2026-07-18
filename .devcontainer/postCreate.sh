#!/usr/bin/env bash
# Provision a dev container that can run the full CI matrix locally, not just
# `npm test`: the unit suite, the tshark PCAP-validation job, and the
# Playwright end-to-end job (see .github/workflows/verify.yml).
#
# Shared by both devcontainer variants. The default image runs as `node`
# (with passwordless sudo); the Podman variant runs as root. `sudo` is present
# either way and is a no-op for root, so no user detection is needed — this
# mirrors exactly what CI runs.
set -euo pipefail

# Clean, reproducible install. Also sidesteps a known npm bug where rolldown's
# native binding (an optional dependency of vite) goes missing after
# incremental installs.
npm ci

# tshark: independently dissects exported PCAPs in `npm run test:tshark`.
sudo sh -c 'DEBIAN_FRONTEND=noninteractive apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tshark'

# Chromium + its system libraries for `npm run test:e2e`.
npx playwright install --with-deps chromium
