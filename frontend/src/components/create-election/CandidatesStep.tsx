import { useEffect, useRef, useState } from "react";
import { useChainId } from "wagmi";
import { useCandidates } from "../../hooks/useCandidates.js";
import { useUploadImage } from "../../hooks/useUploadImage.js";
import { useAddCandidate } from "../../hooks/useAddCandidate.js";
import { useSetCandidateProfile } from "../../hooks/useSetCandidateProfile.js";
import { CandidateCard } from "../CandidateCard.js";
import { MIN_CANDIDATES_FOR_COMPLETE } from "../../hooks/useAdminElections.js";

interface CandidatesStepProps {
  electionId: number;
}

export function CandidatesStep({ electionId }: CandidatesStepProps): JSX.Element {
  const chainId = useChainId();
  const { data: candidates, refetch } = useCandidates(electionId);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [image, setImage] = useState<File | null>(null);

  const upload = useUploadImage();
  const add = useAddCandidate(chainId);
  const setProfile = useSetCandidateProfile();

  const handledCandidateId = useRef<number | null>(null);

  // Once addCandidate() confirms and the candidateId is decoded, set the
  // off-chain bio (a separate off-chain step — bio isn't part of the
  // on-chain Candidate struct) and reset the form for the next
  // candidate. The ref guard makes this idempotent regardless of how
  // often the effect re-runs (e.g. if setProfile/refetch's identity
  // isn't stable across renders) — it only ever acts once per confirmed
  // candidateId, not "once per effect run."
  useEffect(() => {
    if (add.status !== "confirmed" || add.candidateId === null) return;
    if (handledCandidateId.current === add.candidateId) return;
    handledCandidateId.current = add.candidateId;

    if (bio.trim().length > 0) {
      setProfile.mutate({ electionId, candidateId: add.candidateId, bio });
    }
    setName("");
    setBio("");
    setImage(null);
    void refetch();
  }, [add.status, add.candidateId, bio, electionId, refetch, setProfile]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    let metadataURI = "";
    if (image) {
      const result = await upload.mutateAsync(image);
      metadataURI = result.cid; // raw CID, not the resolved gateway URL — candidate.service.ts's own convention
    }
    add.addCandidate(electionId, name, metadataURI);
  }

  const busy = upload.isPending || add.status === "signing" || add.status === "confirming";
  const count = candidates?.length ?? 0;

  return (
    <div className="flex max-w-lg flex-col gap-6">
      {candidates && candidates.length > 0 && (
        <div className="flex flex-col gap-2">
          {candidates.map((c) => (
            <CandidateCard key={c.candidateId} candidate={c} />
          ))}
        </div>
      )}

      <p className="text-sm text-muted">
        {count} of {MIN_CANDIDATES_FOR_COMPLETE} minimum candidates added.
      </p>

      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4 border-t border-border pt-6">
        <div>
          <label htmlFor="candidateName" className="mb-1 block text-sm text-muted">
            Candidate name
          </label>
          <input
            id="candidateName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={busy}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink"
          />
        </div>
        <div>
          <label htmlFor="candidateBio" className="mb-1 block text-sm text-muted">
            Bio (optional)
          </label>
          <textarea
            id="candidateBio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={2}
            disabled={busy}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink"
          />
        </div>
        <div>
          <label htmlFor="candidateImage" className="mb-1 block text-sm text-muted">
            Photo (optional)
          </label>
          <input
            id="candidateImage"
            type="file"
            accept="image/*"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            disabled={busy}
            className="w-full text-sm text-muted"
          />
        </div>

        {(upload.isError || add.error) && (
          <p className="bg-danger-subtle rounded-md p-3 text-sm text-danger">
            {upload.error?.message ?? add.error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || name.trim().length === 0}
          className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {upload.isPending && "Uploading photo…"}
          {add.status === "signing" && "Confirm in wallet…"}
          {add.status === "confirming" && "Waiting for confirmation…"}
          {!busy && "Add candidate"}
        </button>
      </form>
    </div>
  );
}
