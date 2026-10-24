#!/bin/sh
set -eu
RIVET_REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$RIVET_REPO_DIR"
if [ "${RIVET_PUBLIC_IMAGE_AUTH:-}" = anonymous ]; then
  RIVET_DOCKER_ENDPOINT=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}
  case "$RIVET_DOCKER_ENDPOINT" in
    unix://*) ;;
    *) printf '%s\n' 'Anonymous image mode supports local Unix-socket Docker contexts only.' >&2; exit 1 ;;
  esac
  mkdir -p .local/docker-public
  printf '%s\n' '{"auths":{}}' > .local/docker-public/config.json
  export DOCKER_CONFIG="$RIVET_REPO_DIR/.local/docker-public"
  export DOCKER_HOST="$RIVET_DOCKER_ENDPOINT"
  unset DOCKER_CONTEXT
fi
exec docker compose "$@"
