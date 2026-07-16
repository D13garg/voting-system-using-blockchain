#!/bin/sh
# Runs `hardhat node` and deploy.ts in a single container, in that order,
# so `docker compose up` alone produces a running local chain with
# contracts already deployed - no second terminal for `hardhat run
# scripts/deploy.ts --network localhost` needed.
#
# Redeploying on every container start (rather than checking whether
# shared/contract-addresses.json already has a 31337 entry and skipping)
# is deliberate, not an oversight: `hardhat node`'s chain state is
# in-memory and resets to block 0 every time this container starts, so a
# stale addresses entry from a previous run would point at contracts that
# no longer exist on THIS chain instance. Redeploying is cheap (a couple
# of seconds) and, using Hardhat's default deterministic test accounts,
# reproduces the exact same addresses every time anyway, since deploy.ts
# is always the first thing to run against the fresh chain.
set -e

echo "[chain] starting hardhat node on 0.0.0.0:8545..."
npx hardhat node --hostname 0.0.0.0 &
NODE_PID=$!

echo "[chain] waiting for it to accept connections..."
node docker/wait-for-chain.js

echo "[chain] deploying contracts..."
npx hardhat run scripts/deploy.ts --network localhost

# Signals readiness to docker-compose's healthcheck (see
# docker-compose.dev.yml) - api/worker's depends_on:condition:
# service_healthy waits for this file before starting, so they never race
# a chain that hasn't finished deploying yet.
touch /tmp/chain-ready
echo "[chain] ready - contracts deployed, node running."

wait $NODE_PID
