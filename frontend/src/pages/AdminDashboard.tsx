// Section 9: "Admin Dashboard". Will be gated by RoleGuard once role
// checks exist frontend-side — not yet wired in this slice.
export function AdminDashboard(): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
      <h1 className="font-display text-2xl text-ink">Admin dashboard</h1>
      <p className="mt-2 text-sm text-muted">
        Lifecycle controls, registration queue, role management — built in a later slice.
      </p>
    </div>
  );
}
