// Section 9: "Admin Dashboard". Reached only through RoleGuard
// (router.tsx). The "in progress" section (2026-07-14 session) is what
// makes the Create Election wizard's resumability actually reachable —
// without a list here, an admin who closed the tab mid-wizard would have
// no way back to that draft except knowing its Mongo id.
import { Link } from "react-router-dom";
import { useRegistrationRequests } from "../hooks/useRegistrationRequests.js";
import { useAdminElections, isElectionInProgress } from "../hooks/useAdminElections.js";

export function AdminDashboard(): JSX.Element {
  const { data: pending, isLoading: pendingLoading } = useRegistrationRequests("pending", true);
  const { data: allElections, isLoading: electionsLoading } = useAdminElections(true);
  const inProgress = allElections?.filter(isElectionInProgress) ?? [];

  return (
    <div>
      <h1 className="font-display mb-6 text-2xl text-ink">Admin</h1>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          to="/admin/registration-requests"
          className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent"
        >
          <p className="text-sm text-muted">Registration requests</p>
          <p className="font-chain-data mt-1 text-3xl text-ink">
            {pendingLoading ? "…" : (pending?.length ?? 0)}
          </p>
          <p className="mt-1 text-xs text-muted">pending review</p>
        </Link>

        <Link
          to="/admin/elections/new"
          className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent"
        >
          <p className="text-sm text-muted">Elections</p>
          <p className="font-display mt-1 text-xl text-ink">Create election</p>
          <p className="mt-1 text-xs text-muted">draft a new election</p>
        </Link>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">In progress</h2>
        {electionsLoading && (
          <div className="h-16 animate-pulse rounded-lg border border-border bg-surface" aria-busy="true" />
        )}
        {!electionsLoading && inProgress.length === 0 && (
          <p className="text-sm text-muted">No elections are mid-setup right now.</p>
        )}
        {inProgress.length > 0 && (
          <div className="flex flex-col gap-2">
            {inProgress.map((election) => (
              <Link
                key={election.id}
                to={`/admin/elections/${election.id}/continue`}
                className="flex items-center justify-between rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent"
              >
                <span className="text-sm text-ink">{election.title}</span>
                <span className="text-xs text-muted">
                  {election.electionId === null ? "Not yet on-chain" : "Needs more candidates"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
