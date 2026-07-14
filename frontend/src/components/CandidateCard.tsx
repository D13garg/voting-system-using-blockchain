import type { CandidateSummary } from "../hooks/useCandidates.js";

interface CandidateCardProps {
  candidate: CandidateSummary;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (candidateId: number) => void;
}

export function CandidateCard({ candidate, selectable, selected, onSelect }: CandidateCardProps): JSX.Element {
  const content = (
    <>
      <div className="flex items-center gap-3">
        {candidate.imageUrl ? (
          <img
            src={candidate.imageUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full border border-border object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-bg text-sm text-muted">
            {candidate.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{candidate.name}</p>
          <p className="font-chain-data text-xs text-muted">#{candidate.candidateId}</p>
        </div>
      </div>
      {candidate.bio && <p className="mt-3 text-sm text-muted">{candidate.bio}</p>}
    </>
  );

  if (!selectable) {
    return <div className="rounded-lg border border-border bg-surface p-4">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onSelect?.(candidate.candidateId)}
      aria-pressed={selected}
      className={[
        "rounded-lg border p-4 text-left transition-colors",
        selected ? "border-accent bg-accent/5" : "border-border bg-surface hover:border-accent",
      ].join(" ")}
    >
      {content}
    </button>
  );
}
