// Section 9: "Voter Dashboard". Backed by GET /voters/me/elections (see
// HANDOFF.md item 10 for the backend design decision this page's data
// depends on — the first inter-domain-module import in the backend, an
// approved coupling, chosen over a client-side fan-out).
import { useAccount } from "wagmi";
import { useAuth } from "../hooks/useAuth.js";
import { useMyElections } from "../hooks/useMyElections.js";
import { MyElectionRow } from "../components/MyElectionRow.js";

export function VoterDashboard(): JSX.Element {
  const { isConnected } = useAccount();
  const { status: authStatus, signIn } = useAuth();
  const isAuthenticated = authStatus === "authenticated";

  const { data: elections, isLoading, isError, refetch } = useMyElections(isAuthenticated);

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center text-sm text-muted">
        Connect your wallet to see your registrations and votes.
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center text-sm text-muted">
        <button type="button" onClick={() => void signIn()} className="font-medium text-accent hover:underline">
          Sign in
        </button>{" "}
        to see your registrations and votes.
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display mb-6 text-2xl text-ink">Your elections</h1>

      {isLoading && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your elections">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
        </div>
      )}

      {isError && (
        <div className="bg-danger-subtle rounded-lg p-8 text-center text-sm text-danger">
          Couldn't load your elections.{" "}
          <button type="button" onClick={() => void refetch()} className="font-medium underline">
            Try again
          </button>
        </div>
      )}

      {elections && elections.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center text-sm text-muted">
          You haven't registered for or voted in any elections yet.
        </div>
      )}

      {elections && elections.length > 0 && (
        <div className="flex flex-col gap-3">
          {elections.map((election) => (
            <MyElectionRow key={election.id} election={election} />
          ))}
        </div>
      )}
    </div>
  );
}
