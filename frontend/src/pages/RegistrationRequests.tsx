// Section 9: "Registration Requests (admin review queue)". Reached only
// through RoleGuard (router.tsx) — this page itself does not re-check
// the admin role.
import { useState } from "react";
import { useRegistrationRequests } from "../hooks/useRegistrationRequests.js";
import type { RegistrationRequestStatus } from "../hooks/useRegistrationRequests.js";
import { RegistrationRequestRow } from "../components/RegistrationRequestRow.js";

const TABS: { value: RegistrationRequestStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export function RegistrationRequests(): JSX.Element {
  const [tab, setTab] = useState<RegistrationRequestStatus>("pending");
  const { data: requests, isLoading, isError, refetch } = useRegistrationRequests(tab, true);

  return (
    <div>
      <h1 className="font-display mb-6 text-2xl text-ink">Registration requests</h1>

      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={[
              "border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.value ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading requests">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
        </div>
      )}

      {isError && (
        <div className="bg-danger-subtle rounded-lg p-8 text-center text-sm text-danger">
          Couldn't load requests.{" "}
          <button type="button" onClick={() => void refetch()} className="font-medium underline">
            Try again
          </button>
        </div>
      )}

      {requests && requests.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center text-sm text-muted">
          No {tab} requests.
        </div>
      )}

      {requests && requests.length > 0 && (
        <div className="flex flex-col gap-3">
          {requests.map((request) => (
            <RegistrationRequestRow key={request.id} request={request} />
          ))}
        </div>
      )}
    </div>
  );
}
