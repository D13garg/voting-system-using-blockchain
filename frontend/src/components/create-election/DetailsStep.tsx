import { useState } from "react";
import { useCreateDraft } from "../../hooks/useCreateDraft.js";

interface DetailsStepProps {
  onCreated: (draftId: string) => void;
}

export function DetailsStep({ onCreated }: DetailsStepProps): JSX.Element {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const createDraft = useCreateDraft();

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    createDraft.mutate(
      { title, description },
      { onSuccess: (election) => onCreated(election.id) },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-4">
      <div>
        <label htmlFor="title" className="mb-1 block text-sm text-muted">
          Title
        </label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink"
        />
      </div>
      <div>
        <label htmlFor="description" className="mb-1 block text-sm text-muted">
          Description
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink"
        />
      </div>

      {createDraft.isError && (
        <p className="bg-danger-subtle rounded-md p-3 text-sm text-danger">{createDraft.error.message}</p>
      )}

      <button
        type="submit"
        disabled={createDraft.isPending || title.trim().length === 0}
        className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {createDraft.isPending ? "Creating draft…" : "Continue"}
      </button>
    </form>
  );
}
