import { Link } from "react-router-dom";
import type { MyElectionStatus } from "../hooks/useMyElections.js";

function RegistrationBadge({
  registrationStatus,
  onChainConfirmed,
}: Pick<MyElectionStatus, "registrationStatus" | "onChainConfirmed">): JSX.Element {
  if (onChainConfirmed) {
    return (
      <span className="bg-confirmed-subtle inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-confirmed">
        <span className="h-1.5 w-1.5 rounded-full bg-confirmed" />
        Registered
      </span>
    );
  }
  if (registrationStatus === "pending") {
    return (
      <span className="bg-pending-subtle inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-pending">
        <span className="h-1.5 w-1.5 rounded-full bg-pending" />
        Registration pending
      </span>
    );
  }
  if (registrationStatus === "approved") {
    return (
      <span className="bg-pending-subtle inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-pending">
        <span className="h-1.5 w-1.5 rounded-full bg-pending" />
        Approved, awaiting confirmation
      </span>
    );
  }
  if (registrationStatus === "rejected") {
    return (
      <span className="bg-danger-subtle inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-danger">
        Registration rejected
      </span>
    );
  }
  return <span className="text-xs text-muted">Not registered</span>;
}

interface MyElectionRowProps {
  election: MyElectionStatus;
}

export function MyElectionRow({ election }: MyElectionRowProps): JSX.Element {
  return (
    <Link
      to={`/elections/${election.id}`}
      className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent"
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">{election.title}</p>
        <p className="font-chain-data text-xs text-muted">#{election.electionId}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {election.hasVoted && (
          <span className="bg-confirmed-subtle inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-confirmed">
            <span className="h-1.5 w-1.5 rounded-full bg-confirmed" />
            Voted
          </span>
        )}
        <RegistrationBadge registrationStatus={election.registrationStatus} onChainConfirmed={election.onChainConfirmed} />
      </div>
    </Link>
  );
}
