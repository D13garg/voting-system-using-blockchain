import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VoterDashboard } from "./VoterDashboard.js";
import { useAccount } from "wagmi";
import * as useAuthModule from "../hooks/useAuth.js";
import * as useMyElectionsModule from "../hooks/useMyElections.js";
import type { MyElectionStatus } from "../hooks/useMyElections.js";

// wagmi's useAccount is non-configurable — vi.mock the module rather than
// vi.spyOn (real finding from RegistrationGate.test.tsx, same fix here).
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

function mockMyElections(overrides: Partial<ReturnType<typeof useMyElectionsModule.useMyElections>>): void {
  vi.spyOn(useMyElectionsModule, "useMyElections").mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useMyElectionsModule.useMyElections>);
}

function renderDashboard(): ReturnType<typeof render> {
  return render(<VoterDashboard />, { wrapper: MemoryRouter });
}

describe("VoterDashboard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prompts to connect a wallet when none is connected", () => {
    mockWallet(false);
    mockAuth("idle");
    mockMyElections({});
    renderDashboard();
    expect(screen.getByText(/Connect your wallet/)).toBeInTheDocument();
  });

  it("prompts to sign in when connected but not authenticated", () => {
    mockWallet(true);
    mockAuth("idle");
    mockMyElections({});
    renderDashboard();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows a loading state while fetching", () => {
    mockWallet(true);
    mockAuth("authenticated");
    mockMyElections({ isLoading: true });
    renderDashboard();
    expect(screen.getByLabelText("Loading your elections")).toBeInTheDocument();
  });

  it("shows an empty state when the wallet has no election relationships", () => {
    mockWallet(true);
    mockAuth("authenticated");
    mockMyElections({ data: [] });
    renderDashboard();
    expect(screen.getByText(/haven't registered/)).toBeInTheDocument();
  });

  it("renders a row per election", () => {
    const elections: MyElectionStatus[] = [
      { id: "a", electionId: 1, title: "E1", state: "voting_active", registrationStatus: "pending", onChainConfirmed: false, hasVoted: false },
      { id: "b", electionId: 2, title: "E2", state: "result_finalized", registrationStatus: "not_requested", onChainConfirmed: true, hasVoted: true },
    ];
    mockWallet(true);
    mockAuth("authenticated");
    mockMyElections({ data: elections });
    renderDashboard();
    expect(screen.getByText("E1")).toBeInTheDocument();
    expect(screen.getByText("E2")).toBeInTheDocument();
  });
});
