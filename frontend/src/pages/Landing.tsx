// Section 9: "Landing/Home (active elections)" — first real page content
// in Phase 4, replacing the placeholder. Grouping order and refresh
// cadence are the user's approved calls (this slice's design doc);
// drafts are excluded by useElections.ts itself, not filtered here.
import type { ElectionLifecycleState, ElectionSummary } from "../hooks/useElections.js";
import { useElections } from "../hooks/useElections.js";
import { ElectionCard } from "../components/ElectionCard.js";

// Section order is the actual design decision ("Active first") — not
// alphabetical, not the lifecycle's chronological order. A visitor's
// first question is "what can I vote in right now", so that section
// leads regardless of how few or many elections are in it.
const SECTIONS: { state: ElectionLifecycleState; heading: string }[] = [
  { state: "voting_active", heading: "Active now" },
  { state: "voting_scheduled", heading: "Upcoming" },
  { state: "voting_ended", heading: "Awaiting results" },
  { state: "result_finalized", heading: "Recently finalized" },
];

function groupByState(elections: ElectionSummary[]): Map<ElectionLifecycleState, ElectionSummary[]> {
  const groups = new Map<ElectionLifecycleState, ElectionSummary[]>();
  for (const election of elections) {
    const bucket = groups.get(election.state) ?? [];
    bucket.push(election);
    groups.set(election.state, bucket);
  }
  return groups;
}

function LoadingState(): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading elections">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-lg border border-border bg-surface" />
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger-subtle p-8 text-center">
      <p className="text-sm text-danger">Couldn't load elections. The backend may be unreachable.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm text-ink transition-colors hover:border-accent"
      >
        Try again
      </button>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
      <p className="text-sm text-muted">No elections have been created on-chain yet.</p>
    </div>
  );
}

function Hero(): JSX.Element {
  return (
    <div className="bg-hero-wash mb-10 rounded-xl px-8 py-12">
      <h1 className="font-display max-w-xl text-3xl font-medium text-ink sm:text-4xl">
        Every vote, verifiable on-chain.
      </h1>
      <p className="mt-3 max-w-md text-sm text-muted">
        Browse active and past elections. Every result here is confirmed directly from the Ethereum
        blockchain — nothing here is asserted, only recorded.
      </p>
    </div>
  );
}

export function Landing(): JSX.Element {
  const { data: elections, isLoading, isError, refetch } = useElections();

  return (
    <div>
      <Hero />

      {isLoading && <LoadingState />}
      {isError && <ErrorState onRetry={() => void refetch()} />}

      {elections && (
        elections.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-10">
            {SECTIONS.map(({ state, heading }) => {
              const items = groupByState(elections).get(state);
              if (!items || items.length === 0) return null;
              return (
                <section key={state}>
                  <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted">
                    {heading} <span className="font-chain-data text-muted">({items.length})</span>
                  </h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((election) => (
                      <ElectionCard key={election.id} election={election} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
