// RoleGuard (Section 9 — first real use). Gates every /admin/* route.
// Same connect/sign-in prompt convention as RegistrationGate (not shared
// code, just the same visual pattern — the two components check
// different things: RegistrationGate checks a specific election's
// on-chain registration, this checks the wallet's global admin role).
import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "../hooks/useAuth.js";
import { useAdminRole } from "../hooks/useAdminRole.js";

interface RoleGuardProps {
  children: ReactNode;
}

function Centered({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function RoleGuard({ children }: RoleGuardProps): JSX.Element {
  const { isConnected } = useAccount();
  const { status: authStatus, signIn } = useAuth();
  const isAuthenticated = authStatus === "authenticated";
  const { data, isLoading } = useAdminRole(isAuthenticated);

  if (!isConnected) {
    return <Centered>Connect your wallet to access admin tools.</Centered>;
  }

  if (!isAuthenticated) {
    return (
      <Centered>
        <button type="button" onClick={() => void signIn()} className="font-medium text-accent hover:underline">
          Sign in
        </button>{" "}
        to access admin tools.
      </Centered>
    );
  }

  if (isLoading || !data) {
    return <Centered>Checking your admin access…</Centered>;
  }

  if (!data.isElectionAdministrator) {
    return (
      <div className="bg-danger-subtle rounded-lg p-10 text-center text-sm text-danger">
        This wallet does not hold the on-chain administrator role required for this page.
      </div>
    );
  }

  return <>{children}</>;
}
