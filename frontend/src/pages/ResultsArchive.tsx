// Section 9: "Results/Archive" — the last of the 7 pages. Reuses
// useElections() (already fetches + is filtered/grouped by state
// elsewhere, e.g. Landing.tsx) and ArchiveElectionCard.tsx (which itself
// reuses ElectionStateStrip/ResultsBar) rather than adding any new
// backend surface.
//
// SCOPE DECISION: full results shown inline for every finalized
// election, not just a card linking out to each one's detail page —
// chosen to match the "verifiable at a glance" promise from Landing's
// own hero copy, and because ResultsBar/useElectionResults already
// gate correctly on state (voting_ended/result_finalized), so there's
// no new gating logic to get wrong here.
import { useElections } from "../hooks/useElections.js";
import { ArchiveElectionCard } from "../components/ArchiveElectionCard.js";

function LoadingState(): JSX.Element {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading archive">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-lg border border-border bg-surface" />
      ))}
    </div>
  );
}

export function ResultsArchive(): JSX.Element {
  const { data: elections, isLoading, isError, refetch } = useElections();
  // Both result_finalized and archived belong here - this page IS the
  // "Archive" / "Past Elections" view architecture Section 16's table
  // calls for once an election reaches Archived, and a freshly-finalized
  // election shouldn't vanish from it while waiting for that later,
  // separate admin action.
  const finalized = elections?.filter((election) => election.state === "result_finalized" || election.state === "archived") ?? [];

  return (
    <div>
      <h1 className="font-display mb-6 text-2xl text-ink">Archive</h1>

      {isLoading && <LoadingState />}

      {isError && (
        <div className="bg-danger-subtle rounded-lg p-8 text-center text-sm text-danger">
          Couldn't load the archive.{" "}
          <button type="button" onClick={() => void refetch()} className="font-medium underline">
            Try again
          </button>
        </div>
      )}

      {elections && finalized.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center text-sm text-muted">
          No elections have been finalized yet.
        </div>
      )}

      {finalized.length > 0 && (
        <div className="flex flex-col gap-4">
          {finalized.map((election) => (
            <ArchiveElectionCard key={election.id} election={election} />
          ))}
        </div>
      )}
    </div>
  );
}
