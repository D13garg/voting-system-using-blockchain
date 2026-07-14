import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegistrationGate } from "./RegistrationGate.js";
import { useAccount } from "wagmi";
import * as useAuthModule from "../hooks/useAuth.js";
import * as registrationModule from "../hooks/useRegistrationStatus.js";

// wagmi's useAccount export is non-configurable (a real finding from the
// actual test run: vi.spyOn on the module namespace throws "Cannot
// redefine property: useAccount") — mock the whole module instead of
// spying on one export, same pattern WalletStatusBadge/BallotForm's own
// wagmi usage would need if they ever grow a test that needs to control
// wallet state.
vi.mock("wagmi", () => ({ useAccount: vi.fn() }));

function mockWallet(isConnected: boolean): void {
  vi.mocked(useAccount).mockReturnValue({ isConnected } as unknown as ReturnType<typeof useAccount>);
}

function mockAuth(status: "idle" | "authenticated"): void {
  vi.spyOn(useAuthModule, "useAuth").mockReturnValue({
    status,
    address: null,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
}

function mockRegistration(data: Partial<registrationModule.RegistrationStatus> | undefined, isLoading = false): void {
  vi.spyOn(registrationModule, "useRegistrationStatus").mockReturnValue({
    data,
    isLoading,
  } as ReturnType<typeof registrationModule.useRegistrationStatus>);
  vi.spyOn(registrationModule, "useRequestRegistration").mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof registrationModule.useRequestRegistration>);
}

describe("RegistrationGate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prompts to connect a wallet when none is connected", () => {
    mockWallet(false);
    mockAuth("idle");
    mockRegistration(undefined);
    render(<RegistrationGate electionId={1}>ballot</RegistrationGate>);
    expect(screen.getByText(/Connect your wallet/)).toBeInTheDocument();
  });

  it("prompts to sign in when connected but not authenticated", () => {
    mockWallet(true);
    mockAuth("idle");
    mockRegistration(undefined);
    render(<RegistrationGate electionId={1}>ballot</RegistrationGate>);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("offers to request registration when status is not_requested", () => {
    mockWallet(true);
    mockAuth("authenticated");
    mockRegistration({ status: "not_requested", onChainConfirmed: false });
    render(<RegistrationGate electionId={1}>ballot</RegistrationGate>);
    expect(screen.getByRole("button", { name: "Request to vote" })).toBeInTheDocument();
  });

  it("shows a pending notice when approved but NOT yet onChainConfirmed (the real gate, not status)", () => {
    mockWallet(true);
    mockAuth("authenticated");
    mockRegistration({ status: "approved", onChainConfirmed: false });
    render(<RegistrationGate electionId={1}>ballot</RegistrationGate>);
    expect(screen.getByText(/waiting for on-chain confirmation/)).toBeInTheDocument();
    expect(screen.queryByText("ballot")).not.toBeInTheDocument();
  });

  it("renders children once onChainConfirmed is true, even if status hasn't caught up", () => {
    mockWallet(true);
    mockAuth("authenticated");
    mockRegistration({ status: "pending", onChainConfirmed: true });
    render(<RegistrationGate electionId={1}>ballot</RegistrationGate>);
    expect(screen.getByText("ballot")).toBeInTheDocument();
  });

  it("shows a rejection notice for rejected requests", () => {
    mockWallet(true);
    mockAuth("authenticated");
    mockRegistration({ status: "rejected", onChainConfirmed: false });
    render(<RegistrationGate electionId={1}>ballot</RegistrationGate>);
    expect(screen.getByText(/not approved/)).toBeInTheDocument();
  });
});
