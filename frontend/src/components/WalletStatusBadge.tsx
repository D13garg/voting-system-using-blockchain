// Section 9: "WalletStatusBadge". Distinct from WalletConnectButton: that
// component is the *action* (connect/switch/view account); this one is
// *status* (where the user sits in Section 13's role funnel: Guest ->
// Wallet User -> Verified, this component's business, not roles beyond
// that — Election/System Administrator badges belong to RoleGuard-gated
// pages, not this global-header component).
import { useAccount } from "wagmi";
import { useAuth } from "../hooks/useAuth.js";

export function WalletStatusBadge(): JSX.Element {
  const { isConnected } = useAccount();
  const { status, signIn } = useAuth();

  if (!isConnected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-muted" />
        Guest
      </span>
    );
  }

  if (status === "authenticated") {
    return (
      <span className="bg-confirmed-subtle inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-confirmed">
        <span className="h-1.5 w-1.5 rounded-full bg-confirmed" />
        Verified
      </span>
    );
  }

  if (status === "signing" || status === "checking") {
    return (
      <span className="bg-pending-subtle inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-pending">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pending" />
        {status === "signing" ? "Awaiting signature…" : "Checking session…"}
      </span>
    );
  }

  // Connected but not signed in — the actionable state, so it's a button.
  return (
    <button
      type="button"
      onClick={() => void signIn()}
      className="bg-pending-subtle inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-pending transition-opacity hover:opacity-80"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-pending" />
      Sign in to verify
    </button>
  );
}
