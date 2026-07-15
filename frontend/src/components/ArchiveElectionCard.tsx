import { Link } from "react-router-dom";
import type { ElectionSummary } from "../hooks/useElections.js";
import { useElectionResults } from "../hooks/useElectionResults.js";
import { ElectionStateStrip } from "./ElectionStateStrip.js";
import { ResultsBar } from "./ResultsBar.js";

interface ArchiveElectionCardProps {
  election: ElectionSummary;
}

export function ArchiveElectionCard({ election }: ArchiveElectionCardProps): JSX.Element {
  const { data: results, isLoading } = useElectionResults(election.electionId, election.state);

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <Link to={`/elections/${election.id}`} className="font-display text-lg text-ink hover:underline">
            {election.title}
          </Link>
          {election.electionId !== null && (
            <span className="font-chain-data ml-2 text-xs text-muted">#{election.electionId}</span>
          )}
        </div>
      </div>

      <div className="mb-4 max-w-xs">
        <ElectionStateStrip state={election.state} />
      </div>

      {isLoading && <div className="h-16 animate-pulse rounded-md bg-bg" aria-busy="true" />}
      {results && <ResultsBar results={results} />}
    </div>
  );
}
