import { useChainId } from "wagmi";
import type { RegistrationRequestSummary } from "../hooks/useRegistrationRequests.js";
import { useApproveRequest, useRejectRequest } from "../hooks/useRegistrationRequests.js";
import { useConfirmRegistration } from "../hooks/useConfirmRegistration.js";

interface RegistrationRequestRowProps {
  request: RegistrationRequestSummary;
}

export function RegistrationRequestRow({ request }: RegistrationRequestRowProps): JSX.Element {
  const chainId = useChainId();
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const confirm = useConfirmRegistration(request.electionId, request.voterAddress, chainId);

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">{request.voterDisplayName}</p>
        <p className="font-chain-data text-xs text-muted">
          Election #{request.electionId} · requested {new Date(request.requestedAt).toLocaleDateString()}
        </p>
        {confirm.error && <p className="mt-1 text-xs text-danger">{confirm.error}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {request.onChainConfirmed ? (
          <span className="bg-confirmed-subtle inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-confirmed">
            <span className="h-1.5 w-1.5 rounded-full bg-confirmed" />
            Confirmed on-chain
          </span>
        ) : request.status === "pending" ? (
          <>
            <button
              type="button"
              onClick={() => reject.mutate(request.id)}
              disabled={reject.isPending || approve.isPending}
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm text-ink transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => approve.mutate(request.id)}
              disabled={reject.isPending || approve.isPending}
              className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {approve.isPending ? "Approving…" : "Approve"}
            </button>
          </>
        ) : request.status === "approved" ? (
          <button
            type="button"
            onClick={confirm.confirmOnChain}
            disabled={confirm.status === "signing" || confirm.status === "confirming"}
            className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {confirm.status === "signing" && "Confirm in wallet…"}
            {confirm.status === "confirming" && "Waiting for confirmation…"}
            {(confirm.status === "idle" || confirm.status === "error") && "Confirm on-chain"}
          </button>
        ) : (
          <span className="bg-danger-subtle inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-danger">
            Rejected
          </span>
        )}
      </div>
    </div>
  );
}
