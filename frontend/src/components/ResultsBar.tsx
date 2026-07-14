import type { ElectionResults } from "../hooks/useElectionResults.js";

interface ResultsBarProps {
  results: ElectionResults;
}

export function ResultsBar({ results }: ResultsBarProps): JSX.Element {
  const sorted = [...results.candidates].sort((a, b) => b.voteCount - a.voteCount);
  const max = Math.max(1, ...sorted.map((c) => c.voteCount));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        <span className="font-chain-data text-ink">{results.totalVotes}</span> total votes
      </p>
      <div className="flex flex-col gap-3">
        {sorted.map((candidate) => {
          const pct = results.totalVotes === 0 ? 0 : Math.round((candidate.voteCount / results.totalVotes) * 100);
          return (
            <div key={candidate.candidateId}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-ink">{candidate.name}</span>
                <span className="font-chain-data text-muted">
                  {candidate.voteCount} ({pct}%)
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-border">
                <div
                  className="bg-confirmed h-full rounded-full"
                  style={{ width: `${(candidate.voteCount / max) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
