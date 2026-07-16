#!/bin/bash
# Single-command local dev: the Docker stack (chain, mongodb, redis, api,
# worker) plus the natively-run frontend, together. Ctrl+C stops both.
#
# The frontend deliberately stays outside Docker (see docker-compose.yml's
# header comment - Vite HMR) rather than trying to fold it into the
# compose stack too, so this script is the actual "one command" instead
# of asking that decision to be reversed.
#
# Requires backend/.env.docker to exist (copy backend/.env.docker.example
# and, if you want IPFS/email features to actually work rather than just
# start, fill in real keys) and frontend/.env.local to exist (copy
# frontend/.env.example) - checked below rather than failing deep inside
# a container with a confusing error.
set -e

cd "$(dirname "$0")"

if [ ! -f backend/.env.docker ]; then
  echo "Missing backend/.env.docker - copy backend/.env.docker.example and fill it in first:"
  echo "  cp backend/.env.docker.example backend/.env.docker"
  exit 1
fi

if [ ! -f frontend/.env.local ]; then
  echo "Missing frontend/.env.local - copy frontend/.env.example and fill it in first:"
  echo "  cp frontend/.env.example frontend/.env.local"
  exit 1
fi

cleanup() {
  echo ""
  echo "Stopping..."
  kill 0
}
trap cleanup EXIT INT TERM

docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build &
DOCKER_PID=$!

pnpm --filter @dvs/frontend dev &
FRONTEND_PID=$!

# Watchdog: these two run in parallel with no ordering between them, so
# if the Docker stack fails or exits early (Docker Desktop not running,
# a build error, etc.), don't just leave the frontend running uselessly
# against a backend that was never there - report it loudly and tear
# everything down. `wait -n` would be simpler but isn't in macOS's
# default /bin/bash (still 3.2); this subshell form works everywhere.
(
  wait $DOCKER_PID
  code=$?
  if [ $code -ne 0 ]; then
    echo ""
    echo "Docker stack exited unexpectedly (code $code) - stopping. Run"
    echo "'docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build'"
    echo "directly to see the real error (often: Docker Desktop isn't running)."
    kill 0
  fi
) &

wait $DOCKER_PID $FRONTEND_PID