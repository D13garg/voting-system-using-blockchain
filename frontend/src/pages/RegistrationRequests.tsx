// Section 9: "Registration Requests (admin review queue)".
export function RegistrationRequests(): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
      <h1 className="font-display text-2xl text-ink">Registration requests</h1>
      <p className="mt-2 text-sm text-muted">Approval queue — built in a later slice.</p>
    </div>
  );
}
