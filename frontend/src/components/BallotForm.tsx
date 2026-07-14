import { useState } from "react";
import type { CandidateSummary } from "../hooks/useCandidates.js";
import { CandidateCard } from "./CandidateCard.js";

interface BallotFormProps {
  candidates: CandidateSummary[];
  status: "idle" | "signing" | "confirming" | "confirmed" | "error";
  error: string | null;
  onSubmit: (candidateId: number) => void;
}

export function BallotForm({ candidates, status, error, onSubmit }: BallotFormProps): JSX.Element {
  const [selected, setSelected] = useState<number | null>(null);
  const busy = status === "signing" || status === "confirming";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {candidates.map((candidate) => (
          <CandidateCard
            key={candidate.candidateId}
            candidate={candidate}
            selectable
            selected={selected === candidate.candidateId}
            onSelect={busy ? undefined : setSelected}
          />
        ))}
      </div>

      {error && (
        <p className="bg-danger-subtle rounded-md p-3 text-sm text-danger">{error}</p>
      )}

      <button
        type="button"
        disabled={selected === null || busy}
        onClick={() => selected !== null && onSubmit(selected)}
        className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "signing" && "Confirm in wallet…"}
        {status === "confirming" && "Waiting for confirmation…"}
        {(status === "idle" || status === "error") && "Cast vote"}
      </button>
    </div>
  );
}
