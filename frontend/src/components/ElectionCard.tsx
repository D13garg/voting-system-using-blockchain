import { Link } from "react-router-dom";
import type { ElectionSummary } from "../hooks/useElections.js";
import { ElectionStateStrip } from "./ElectionStateStrip.js";

interface ElectionCardProps {
  election: ElectionSummary;
}

function formatDateRange(startTime?: string, endTime?: string): string | null {
  if (!startTime || !endTime) return null;
  const start = new Date(startTime);
  const end = new Date(endTime);
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export function ElectionCard({ election }: ElectionCardProps): JSX.Element {
  const dateRange = formatDateRange(election.startTime, election.endTime);

  return (
    <Link
      to={`/elections/${election.id}`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg leading-snug text-ink">{election.title}</h3>
        {election.electionId !== null && (
          <span className="font-chain-data shrink-0 text-xs text-muted">#{election.electionId}</span>
        )}
      </div>

      {election.description && (
        <p className="line-clamp-2 text-sm text-muted">{election.description}</p>
      )}

      <div className="flex items-center justify-between text-xs text-muted">
        {dateRange && <span className="font-chain-data">{dateRange}</span>}
        {election.candidateCount !== undefined && (
          <span className="font-chain-data">
            {election.candidateCount} candidate{election.candidateCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <ElectionStateStrip state={election.state} />
    </Link>
  );
}
