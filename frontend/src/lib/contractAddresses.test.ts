import { describe, expect, it } from "vitest";
import { getContractAddresses, hasDeployedContracts } from "./contractAddresses.js";

describe("getContractAddresses", () => {
  it("returns configured addresses for a known chain (Sepolia)", () => {
    const result = getContractAddresses(11155111);
    expect(result.network).toBe("sepolia");
    expect(result.voterRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(result.election).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("returns configured addresses for local Hardhat", () => {
    const result = getContractAddresses(31337);
    expect(result.network).toBe("hardhat-local");
  });

  it("throws for an unconfigured chain", () => {
    expect(() => getContractAddresses(1)).toThrow(/No contract addresses configured/);
  });
});

describe("hasDeployedContracts", () => {
  it("is false for the current placeholder zero addresses (Sepolia deployment still deferred — HANDOFF.md)", () => {
    expect(hasDeployedContracts(11155111)).toBe(false);
  });

  it("is false (not throwing) for an unconfigured chain", () => {
    expect(hasDeployedContracts(1)).toBe(false);
  });
});
