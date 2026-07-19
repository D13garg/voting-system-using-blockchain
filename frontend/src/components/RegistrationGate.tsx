import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { useAdminRole } from "../hooks/useAdminRole.js";
import { useRegistrationStatus, useRequestRegistration } from "../hooks/useRegistrationStatus.js";

interface RegistrationGateProps {
  electionId: number | null | undefined;
  children: ReactNode;
}

function Notice({ tone, children }: { tone: "pending" | "muted" | "danger"; children: ReactNode }): JSX.Element {
  const toneClass =
    tone === "pending" ? "bg-pending-subtle text-pending" : tone === "danger" ? "bg-danger-subtle text-danger" : "border border-border text-muted";
  return <div className={`rounded-lg p-4 text-sm ${toneClass}`}>{children}</div>;
}

export function RegistrationGate({ electionId, children }: RegistrationGateProps): JSX.Element {
  const { isConnected } = useAccount();
  const { status: authStatus, signIn } = useAuth();
  const isAuthenticated = authStatus === "authenticated";
  const { data: registration, isLoading } = useRegistrationStatus(electionId, isAuthenticated);
  const requestRegistration = useRequestRegistration(electionId);
  // Only fetched to decide whether to show the admin-only link below -
  // most voters seeing this notice are NOT admins (RoleGuard would block
  // them from the page this links to), so the wording itself must never
  // assume the reader can act on it. See this file's 2026-07-19 header
  // note above the final return for the fuller reasoning.
  const { data: adminRole } = useAdminRole(isAuthenticated);

  if (!isConnected) {
    return <Notice tone="muted">Connect your wallet to check whether you're eligible to vote.</Notice>;
  }

  if (!isAuthenticated) {
    return (
      <Notice tone="muted">
        <button type="button" onClick={() => void signIn()} className="font-medium text-accent hover:underline">
          Sign in
        </button>{" "}
        to check your eligibility and vote.
      </Notice>
    );
  }

  if (isLoading || !registration) {
    return <Notice tone="muted">Checking your registration status…</Notice>;
  }

  // The real gate is onChainConfirmed, not status — an "approved" review
  // decision with no confirmed registerVoter() tx yet still can't vote
  // on-chain (admin.types.ts's own header comment on why these two
  // fields are independent).
  if (registration.onChainConfirmed) {
    return <>{children}</>;
  }

  if (registration.status === "not_requested") {
    return (
      <Notice tone="muted">
        <p className="mb-3">You haven't requested to vote in this election yet.</p>
        <button
          type="button"
          onClick={() => requestRegistration.mutate()}
          disabled={requestRegistration.isPending}
          className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {requestRegistration.isPending ? "Requesting…" : "Request to vote"}
        </button>
      </Notice>
    );
  }

  if (registration.status === "rejected") {
    return <Notice tone="danger">Your registration request for this election was not approved.</Notice>;
  }

  if (registration.status === "pending") {
    return <Notice tone="pending">Your request is awaiting admin review.</Notice>;
  }

  // status === "approved" but onChainConfirmed is still false.
  //
  // UX FIX (2026-07-19, real bug found during the Sepolia smoke test):
  // this used to read "waiting for on-chain confirmation, this can take
  // a few minutes" - phrasing that implies a transient, self-resolving
  // state. It isn't one: onChainConfirmed only flips once an
  // administrator manually clicks "Confirm on-chain" on
  // /admin/registration-requests's Approved tab (a real, separate,
  // gas-paying transaction - see useConfirmRegistration.ts's header
  // comment for why that's deliberately not folded into the approve
  // step). A real voter hit this, assumed something was broken, and had
  // no way to tell otherwise. Most voters aren't admins and couldn't act
  // on a link to that page anyway (it's RoleGuard-gated) - so the
  // wording has to be honest for a non-admin reader by default, with the
  // link only shown to a wallet that actually holds the role.
  return (
    <Notice tone="pending">
      <p>An administrator still needs to confirm this on-chain before you can vote.</p>
      {adminRole?.isElectionAdministrator && (
        <p className="mt-2">
          <Link to="/admin/registration-requests" className="font-medium text-accent hover:underline">
            Go to Registration Requests
          </Link>
        </p>
      )}
    </Notice>
  );
}