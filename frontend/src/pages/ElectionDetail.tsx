// Section 9: "Election Detail (candidates/voting/results)". First page
// where wallet connection, SIWE auth, and the direct-to-chain write path
// (architecture Section 8/9: vote() is wallet-direct, no backend relay —
// see useCastVote.ts) all get exercised together.
//
// ID SPACE: the URL param is the Mongo draft id (matches ElectionCard's
// link and GET /elections/:id — election.routes.ts's `:id` there is
// strictly `findById`, not the on-chain id). Every other call on this
// page (candidates/results/has-voted/registration) needs the on-chain
// numeric `electionId` instead, read off the fetched election summary
// once it loads — see useElection.ts's header comment for why this
// split exists rather than being "fixed" by adding a second URL param.
import { useChainId, useAccount } from "wagmi";
import { Link, useParams } from "react-router-dom";
import { useElection } from "../hooks/useElection.js";
import { useCandidates } from "../hooks/useCandidates.js";
import { useElectionResults } from "../hooks/useElectionResults.js";
import { useHasVoted } from "../hooks/useHasVoted.js";
import { useCastVote } from "../hooks/useCastVote.js";
import { useAuth } from "../hooks/useAuth.js";
import { ElectionStateStrip } from "../components/ElectionStateStrip.js";
import { CandidateCard } from "../components/CandidateCard.js";
import { BallotForm } from "../components/BallotForm.js";
import { ResultsBar } from "../components/ResultsBar.js";
import { RegistrationGate } from "../components/RegistrationGate.js";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function ElectionDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const chainId = useChainId();
  const { isConnected } = useAccount();
  const { status: authStatus } = useAuth();
  const isAuthenticated = authStatus === "authenticated";

  const { data: election, isLoading: electionLoading, isError: electionError } = useElection(id);
  const electionId = election?.electionId ?? null;

  const { data: candidates, isLoading: candidatesLoading } = useCandidates(electionId);
  const { data: results } = useElectionResults(electionId, election?.state);
  const { data: voteStatus } = useHasVoted(electionId, isAuthenticated);
  const castVote = useCastVote(electionId, chainId);

  if (electionLoading) {
    return <div className="h-64 animate-pulse rounded-lg border border-border bg-surface" aria-busy="true" />;
  }

  if (electionError || !election) {
    return (
      <div className="bg-danger-subtle rounded-lg p-8 text-center text-sm text-danger">
        Couldn't find that election.{" "}
        <Link to="/" className="font-medium underline">
          Back to all elections
        </Link>
      </div>
    );
  }

  const resultsVisible =
    election.state === "voting_ended" || election.state === "result_finalized" || election.state === "archived";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-display text-3xl text-ink">{election.title}</h1>
          {election.electionId !== null && (
            <span className="font-chain-data shrink-0 text-sm text-muted">#{election.electionId}</span>
          )}
        </div>
        {election.description && <p className="mt-2 max-w-2xl text-muted">{election.description}</p>}
        {election.startTime && election.endTime && (
          <p className="font-chain-data mt-2 text-xs text-muted">
            {formatDateTime(election.startTime)} – {formatDateTime(election.endTime)}
          </p>
        )}
        <div className="mt-5 max-w-md">
          <ElectionStateStrip state={election.state} />
        </div>
      </div>

      {election.state === "draft" && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">
          This election hasn't been created on-chain yet.
        </div>
      )}

      {election.state !== "draft" && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">Candidates</h2>
          {candidatesLoading && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-surface" />
              ))}
            </div>
          )}

          {candidates && election.state === "voting_active" && (
            <RegistrationGate electionId={electionId}>
              {voteStatus?.hasVoted ? (
                <div className="bg-confirmed-subtle rounded-lg p-4 text-sm text-confirmed">
                  You've voted in this election. Results will be visible once voting ends.
                </div>
              ) : (
                <BallotForm
                  candidates={candidates}
                  status={castVote.status}
                  error={castVote.error}
                  onSubmit={castVote.castVote}
                />
              )}
            </RegistrationGate>
          )}

          {candidates && election.state !== "voting_active" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {candidates.map((candidate) => (
                <CandidateCard key={candidate.candidateId} candidate={candidate} />
              ))}
            </div>
          )}
        </section>
      )}

      {(election.state === "registration_open" || election.state === "registration_closed") && !isConnected && (
        <p className="text-sm text-muted">Voting hasn't started yet — connect a wallet to be ready when it does.</p>
      )}

      {resultsVisible && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">Results</h2>
          {results ? (
            <ResultsBar results={results} />
          ) : (
            <div className="h-24 animate-pulse rounded-lg border border-border bg-surface" />
          )}
        </section>
      )}
    </div>
  );
}
