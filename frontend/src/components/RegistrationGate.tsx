import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "../hooks/useAuth.js";
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
  return <Notice tone="pending">Approved — waiting for on-chain confirmation. This can take a few minutes.</Notice>;
}
