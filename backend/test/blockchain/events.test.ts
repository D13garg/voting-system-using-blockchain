// Tests getNewLogs' chunked eth_getLogs behavior
// (src/modules/blockchain/events.ts), added this session after a real
// Sepolia run against a free-tier Alchemy RPC failed outright with
// InvalidRequestRpcError: the RPC hard-caps eth_getLogs at a 10-block
// range per call, and a single call spanning a larger catch-up gap (a
// fresh deploy, or the worker having been offline a while) is rejected
// entirely, not partially served. See env.ts's RPC_GET_LOGS_MAX_BLOCK_RANGE
// comment for the full context.
//
// Pure unit test - a fake viem PublicClient (getBlockNumber/getLogs only,
// the two methods getNewLogs actually calls), no Mongo, no network. Same
// test-double philosophy as eventSync.test.ts's FakePublicClient, but
// this one also RECORDS every getLogs call's {fromBlock, toBlock} so the
// chunking behavior itself - not just the end result - can be asserted.
//
// env.ts is a module-load-time singleton (see env.test.ts's own header
// comment on why), so each test that needs a specific
// RPC_GET_LOGS_MAX_BLOCK_RANGE re-imports both env.ts and events.ts with
// a cache-busting query string, matching env.test.ts's established
// pattern for this exact problem.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Log } from "viem";

const REQUIRED_VALID_ENV = {
    RPC_URL_PRIMARY: "https://eth-sepolia.g.alchemy.com/v2/test-key",
    RPC_URL_FALLBACK: "https://sepolia.infura.io/v3/test-key",
    CONTRACT_ADDRESS_VOTER_REGISTRY: "0x0000000000000000000000000000000000000001",
    CONTRACT_ADDRESS_ELECTION: "0x0000000000000000000000000000000000000002",
    MONGODB_URI: "mongodb://localhost:27017/test",
    REDIS_URL: "redis://localhost:6379",
    IPFS_API_KEY: "test-ipfs-key",
    IPFS_API_SECRET: "test-ipfs-secret",
    SIWE_DOMAIN: "localhost:5173",
    SIWE_SESSION_SECRET: "a-valid-secret-that-is-at-least-32-characters-long",
    FRONTEND_ORIGIN: "http://localhost:5173",
    RESEND_API_KEY: "test-resend-key",
};

interface RecordedCall {
    fromBlock: bigint;
    toBlock: bigint;
}

class FakePublicClient {
    blockNumber = 0n;
    logs: Log[] = [];
    calls: RecordedCall[] = [];

    async getBlockNumber(): Promise<bigint> {
        return this.blockNumber;
    }

    async getLogs(params: { fromBlock: bigint; toBlock: bigint }): Promise<Log[]> {
        this.calls.push({ fromBlock: params.fromBlock, toBlock: params.toBlock });
        return this.logs.filter(
            (log) => log.blockNumber! >= params.fromBlock && log.blockNumber! <= params.toBlock,
        );
    }
}

function makeLog(blockNumber: bigint, logIndex: number): Log {
    return {
        address: "0x0000000000000000000000000000000000000001",
        blockHash: "0x" + "a".repeat(64),
        blockNumber,
        data: "0x",
        logIndex,
        removed: false,
        topics: [],
        transactionHash: "0x" + blockNumber.toString(16).padStart(64, "0"),
        transactionIndex: 0,
        ...({ args: {}, eventName: "Test" } as object),
    } as unknown as Log;
}

const originalEnv = { ...process.env };

afterEach(() => {
    process.env = { ...originalEnv };
});

describe("getNewLogs chunking", () => {
    it("splits a large catch-up range into RPC_GET_LOGS_MAX_BLOCK_RANGE-sized windows, never exceeding it in one call", async () => {
        process.env = { ...originalEnv, ...REQUIRED_VALID_ENV, RPC_GET_LOGS_MAX_BLOCK_RANGE: "10" };
        vi.resetModules();
        const { getNewLogs } = await import("../../src/modules/blockchain/events.ts?chunk-large-range");

        const client = new FakePublicClient();
        client.blockNumber = 1005n;

        const result = await getNewLogs({
            address: "0x0000000000000000000000000000000000000001",
            event: { type: "event", name: "Test", inputs: [] } as never,
            checkpoint: { lastProcessedBlock: 100n },
            client: client as never,
        });

        for (const call of client.calls) {
            expect(call.toBlock - call.fromBlock + 1n).toBeLessThanOrEqual(10n);
        }
        // Contiguous, no gaps: each call's fromBlock is exactly the previous
        // call's toBlock + 1.
        for (let i = 1; i < client.calls.length; i++) {
            expect(client.calls[i].fromBlock).toBe(client.calls[i - 1].toBlock + 1n);
        }
        expect(client.calls[0].fromBlock).toBe(100n);
        expect(client.calls[client.calls.length - 1].toBlock).toBe(1005n);
        expect(result.newCheckpoint.lastProcessedBlock).toBe(1005n);
    });

    it("makes exactly one call when the range already fits within the configured max", async () => {
        process.env = { ...originalEnv, ...REQUIRED_VALID_ENV, RPC_GET_LOGS_MAX_BLOCK_RANGE: "10" };
        vi.resetModules();
        const { getNewLogs } = await import("../../src/modules/blockchain/events.ts?chunk-small-range");

        const client = new FakePublicClient();
        client.blockNumber = 105n;

        await getNewLogs({
            address: "0x0000000000000000000000000000000000000001",
            event: { type: "event", name: "Test", inputs: [] } as never,
            checkpoint: { lastProcessedBlock: 100n },
            client: client as never,
        });

        expect(client.calls).toHaveLength(1);
        expect(client.calls[0]).toEqual({ fromBlock: 100n, toBlock: 105n });
    });

    it("still queries the single overlapping block when checkpoint equals the current head", async () => {
        process.env = { ...originalEnv, ...REQUIRED_VALID_ENV, RPC_GET_LOGS_MAX_BLOCK_RANGE: "10" };
        vi.resetModules();
        const { getNewLogs } = await import("../../src/modules/blockchain/events.ts?chunk-zero-range");

        const client = new FakePublicClient();
        client.blockNumber = 100n;

        await getNewLogs({
            address: "0x0000000000000000000000000000000000000001",
            event: { type: "event", name: "Test", inputs: [] } as never,
            checkpoint: { lastProcessedBlock: 100n },
            client: client as never,
        });

        expect(client.calls).toEqual([{ fromBlock: 100n, toBlock: 100n }]);
    });

    it("returns logs from every chunk, not just the last one", async () => {
        process.env = { ...originalEnv, ...REQUIRED_VALID_ENV, RPC_GET_LOGS_MAX_BLOCK_RANGE: "10" };
        vi.resetModules();
        const { getNewLogs } = await import("../../src/modules/blockchain/events.ts?chunk-collects-all-logs");

        const client = new FakePublicClient();
        client.blockNumber = 50n;
        client.logs = [makeLog(1n, 0), makeLog(15n, 0), makeLog(49n, 0)];

        const result = await getNewLogs({
            address: "0x0000000000000000000000000000000000000001",
            event: { type: "event", name: "Test", inputs: [] } as never,
            checkpoint: { lastProcessedBlock: 0n },
            client: client as never,
        });

        expect(result.logs.map((l) => l.blockNumber)).toEqual([1n, 15n, 49n]);
        expect(client.calls.length).toBeGreaterThan(1);
    });

    it("respects a larger configured max range (e.g. a paid RPC tier), issuing fewer calls", async () => {
        process.env = { ...originalEnv, ...REQUIRED_VALID_ENV, RPC_GET_LOGS_MAX_BLOCK_RANGE: "500" };
        vi.resetModules();
        const { getNewLogs } = await import("../../src/modules/blockchain/events.ts?chunk-large-max");

        const client = new FakePublicClient();
        client.blockNumber = 1000n;

        await getNewLogs({
            address: "0x0000000000000000000000000000000000000001",
            event: { type: "event", name: "Test", inputs: [] } as never,
            checkpoint: { lastProcessedBlock: 0n },
            client: client as never,
        });

        expect(client.calls).toHaveLength(3); // [0,499], [500,999], [1000,1000]
    });
});