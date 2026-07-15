import { useEffect, useRef, useState } from "react";
import { useChainId } from "wagmi";
import { useCreateElectionOnChain } from "../../hooks/useCreateElectionOnChain.js";
import { useLinkOnChain } from "../../hooks/useLinkOnChain.js";

interface LinkStepProps {
  draftId: string;
  title: string;
  onLinked: () => void;
}

export function LinkStep({ draftId, title, onLinked }: LinkStepProps): JSX.Element {
  const chainId = useChainId();
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const create = useCreateElectionOnChain(chainId);
  const link = useLinkOnChain();
  const handledTxHash = useRef<string | null>(null);

  // Once createElection() confirms and the electionId is decoded from
  // the receipt, immediately tell the backend (step 3) — the admin
  // shouldn't need a second click for this half. Ref guard keyed on the
  // tx hash makes this idempotent regardless of how often the effect
  // re-runs, same reasoning as CandidatesStep.tsx's identical pattern.
  useEffect(() => {
    if (create.status !== "confirmed" || create.electionId === null || !create.transactionHash) return;
    if (handledTxHash.current === create.transactionHash) return;
    handledTxHash.current = create.transactionHash;

    link.mutate(
      { draftId, electionId: create.electionId, transactionHash: create.transactionHash },
      { onSuccess: () => onLinked() },
    );
  }, [create.status, create.electionId, create.transactionHash, draftId, link, onLinked]);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    create.createElectionOnChain(title, new Date(startTime), new Date(endTime));
  }

  const busy = create.status === "signing" || create.status === "confirming" || link.isPending;

  return (
    <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-4">
      <p className="text-sm text-muted">
        "{title}" is saved as a draft. Now submit the on-chain transaction that actually creates it.
      </p>
      <div>
        <label htmlFor="startTime" className="mb-1 block text-sm text-muted">
          Voting starts
        </label>
        <input
          id="startTime"
          type="datetime-local"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          required
          disabled={busy}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink"
        />
      </div>
      <div>
        <label htmlFor="endTime" className="mb-1 block text-sm text-muted">
          Voting ends
        </label>
        <input
          id="endTime"
          type="datetime-local"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          required
          disabled={busy}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink"
        />
      </div>

      {(create.error ?? link.error) && (
        <p className="bg-danger-subtle rounded-md p-3 text-sm text-danger">
          {create.error ?? link.error?.message}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {create.status === "signing" && "Confirm in wallet…"}
        {create.status === "confirming" && "Waiting for confirmation…"}
        {link.isPending && "Linking…"}
        {create.status === "idle" || create.status === "error" ? "Create on-chain" : null}
      </button>
    </form>
  );
}
