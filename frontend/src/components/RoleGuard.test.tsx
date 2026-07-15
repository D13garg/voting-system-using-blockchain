import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoleGuard } from "./RoleGuard.js";
import { useAccount } from "wagmi";
import * as useAuthModule from "../hooks/useAuth.js";
import * as useAdminRoleModule from "../hooks/useAdminRole.js";

// wagmi's useAccount is non-configurable — vi.mock the module rather than
// vi.spyOn (same finding as RegistrationGate.test.tsx/VoterDashboard.test.tsx).
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

function mockAdminRole(data: { isElectionAdministrator: boolean } | undefined, isLoading = false): void {
  vi.spyOn(useAdminRoleModule, "useAdminRole").mockReturnValue({
    data,
    isLoading,
  } as ReturnType<typeof useAdminRoleModule.useAdminRole>);
}

describe("RoleGuard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prompts to connect a wallet when none is connected", () => {
    mockWallet(false);
    mockAuth("idle");
    mockAdminRole(undefined);
    render(<RoleGuard>admin content</RoleGuard>);
    expect(screen.getByText(/Connect your wallet/)).toBeInTheDocument();
    expect(screen.queryByText("admin content")).not.toBeInTheDocument();
  });

  it("prompts to sign in when connected but not authenticated", () => {
    mockWallet(true);
    mockAuth("idle");
    mockAdminRole(undefined);
    render(<RoleGuard>admin content</RoleGuard>);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows a loading state while the role check is in flight", () => {
    mockWallet(true);
    mockAuth("authenticated");
    mockAdminRole(undefined, true);
    render(<RoleGuard>admin content</RoleGuard>);
    expect(screen.getByText(/Checking your admin access/)).toBeInTheDocument();
  });

  it("denies access with a clear message for a non-admin wallet", () => {
    mockWallet(true);
    mockAuth("authenticated");
    mockAdminRole({ isElectionAdministrator: false });
    render(<RoleGuard>admin content</RoleGuard>);
    expect(screen.getByText(/does not hold the on-chain administrator role/)).toBeInTheDocument();
    expect(screen.queryByText("admin content")).not.toBeInTheDocument();
  });

  it("renders children for a confirmed admin wallet", () => {
    mockWallet(true);
    mockAuth("authenticated");
    mockAdminRole({ isElectionAdministrator: true });
    render(<RoleGuard>admin content</RoleGuard>);
    expect(screen.getByText("admin content")).toBeInTheDocument();
  });
});
