// Section 9: "Create Election (admin form)". Reached only through
// RoleGuard (router.tsx). RESUMABLE (2026-07-14 session, user's approved
// call over single-sitting-only): the wizard's current step is derived
// entirely from the fetched draft's own state (electionId null vs set,
// candidateCount vs MIN_CANDIDATES_FOR_COMPLETE) — there's no separate
// "wizard progress" field anywhere. That means refreshing the page,
// closing the tab, or navigating in from Admin Dashboard's "in progress"
// list (AdminDashboard.tsx) all resume at exactly the right step for
// free, because the step was never state that could get out of sync
// with reality in the first place.
import { Link, useNavigate, useParams } from "react-router-dom";
import { useElection } from "../hooks/useElection.js";
import { MIN_CANDIDATES_FOR_COMPLETE } from "../hooks/useAdminElections.js";
import { DetailsStep } from "../components/create-election/DetailsStep.js";
import { LinkStep } from "../components/create-election/LinkStep.js";
import { CandidatesStep } from "../components/create-election/CandidatesStep.js";

export function CreateElection(): JSX.Element {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  if (!id) {
    return (
      <div>
        <h1 className="font-display mb-6 text-2xl text-ink">Create election</h1>
        <DetailsStep onCreated={(draftId) => navigate(`/admin/elections/${draftId}/continue`)} />
      </div>
    );
  }

  return <ResumeWizard id={id} />;
}

function ResumeWizard({ id }: { id: string }): JSX.Element {
  const { data: election, isLoading, isError, refetch } = useElection(id);

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-lg border border-border bg-surface" aria-busy="true" />;
  }

  if (isError || !election) {
    return (
      <div className="bg-danger-subtle rounded-lg p-8 text-center text-sm text-danger">
        Couldn't find that draft.{" "}
        <Link to="/admin" className="font-medium underline">
          Back to admin
        </Link>
      </div>
    );
  }

  const isComplete = election.electionId !== null && (election.candidateCount ?? 0) >= MIN_CANDIDATES_FOR_COMPLETE;

  return (
    <div>
      <h1 className="font-display mb-6 text-2xl text-ink">{election.title}</h1>

      {election.electionId === null && (
        <LinkStep draftId={id} title={election.title} onLinked={() => void refetch()} />
      )}

      {election.electionId !== null && !isComplete && <CandidatesStep electionId={election.electionId} />}

      {isComplete && (
        <div className="bg-confirmed-subtle rounded-lg p-6 text-sm text-confirmed">
          <p className="mb-3">This election is ready.</p>
          <Link to={`/elections/${election.id}`} className="font-medium underline">
            View election
          </Link>
        </div>
      )}
    </div>
  );
}
