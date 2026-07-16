#!/bin/sh
# Bridges shared/contract-addresses.json (written by the `chain` service's
# deploy step) into the CONTRACT_ADDRESS_VOTER_REGISTRY/CONTRACT_ADDRESS_ELECTION
# env vars src/config/env.ts requires. The backend has never read that
# JSON file directly (it's a frontend-only artifact per
# contracts/scripts/contractAddresses.ts's own header comment) and this
# script deliberately doesn't change that - env.ts's validated env-var
# contract is left exactly as every other consumer expects it; this just
# fills in real values before the app process starts, in place of the
# placeholder zero address backend/.env.docker has on disk.
#
# Also acts as defense in depth alongside docker-compose.dev.yml's
# healthcheck-gated depends_on: that only blocks the *initial* container
# start on the chain service being ready - a later `docker compose
# restart api` wouldn't re-wait on depends_on at all, so this still
# guards that case.
set -e

CHAIN_ID="${CHAIN_ID:-31337}"
ADDR_FILE=/app/shared/contract-addresses.json

echo "[api/worker] waiting for shared/contract-addresses.json to have a chain $CHAIN_ID entry..."
until [ -f "$ADDR_FILE" ] && node -e "process.exit(require('$ADDR_FILE')['$CHAIN_ID'] ? 0 : 1)" 2>/dev/null; do
  sleep 1
done

export CONTRACT_ADDRESS_VOTER_REGISTRY="$(node -e "console.log(require('$ADDR_FILE')['$CHAIN_ID'].voterRegistry)")"
export CONTRACT_ADDRESS_ELECTION="$(node -e "console.log(require('$ADDR_FILE')['$CHAIN_ID'].election)")"

echo "[api/worker] contract addresses injected: voterRegistry=$CONTRACT_ADDRESS_VOTER_REGISTRY election=$CONTRACT_ADDRESS_ELECTION"

exec "$@"
