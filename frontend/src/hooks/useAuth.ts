// SIWE authentication hook (architecture Section 9's "Wallet Connection
// Flow", last step: "for admin/voter features, SIWE signature to
// authenticate with backend"). Deliberately separate from wallet
// *connection* (Wagmi/RainbowKit own that state entirely) — this hook
// only owns the backend session on top of an already-connected wallet,
// EXCEPT that it also clears that session when the wallet disconnects
// (see the isConnectedRef effect below) — wallet connection and the
// backend session are different lifecycles that need to end together
// even though they don't start together.
//
// Request/response shapes match backend/src/modules/auth/auth.routes.ts
// exactly: POST /auth/nonce -> { nonce }, POST /auth/siwe -> { message,
// signature } -> { address }, GET /auth/session -> { address } | 401,
// POST /auth/logout -> 204. The session itself is an httpOnly cookie
// (apiClient.ts's credentials:"include" carries it); this hook never
// touches the cookie directly.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { apiFetch, ApiError } from "../lib/apiClient.js";

interface AuthState {
  address: string | null;
  status: "idle" | "checking" | "signing" | "authenticated" | "error";
  error: string | null;
}

export function useAuth(): AuthState & { signIn: () => Promise<void>; signOut: () => Promise<void> } {
  const { address: walletAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();

  const [state, setState] = useState<AuthState>({ address: null, status: "checking", error: null });

  // On mount (and whenever the connected wallet changes), check for an
  // existing session — a page refresh shouldn't force re-signing if the
  // cookie is still valid.
  //
  // Guarded on `!walletAddress` returning early: this effect is also keyed
  // on `walletAddress`, which goes to `undefined` on disconnect at the same
  // time `isConnected` flips false below — without this guard, disconnect
  // triggered BOTH effects, and this one's in-flight GET /auth/session
  // would resolve *after* the other effect's POST /auth/logout and
  // silently overwrite its "idle" state back to "authenticated" (the
  // walletAddress-mismatch check further down never caught it, since a
  // falsy walletAddress skips that check entirely). Root cause of item
  // 18's "Disconnect appeared to do nothing" bug — confirmed via
  // useAuth.test.tsx's disconnect-transition test, not just reasoned
  // about. There is no legitimate reason to ask the backend about a
  // session for a wallet that isn't connected, so the fix is to simply
  // never make that call in the first place, not to reorder/race-guard it.
  useEffect(() => {
    if (!walletAddress) {
      setState({ address: null, status: "idle", error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, status: "checking", error: null }));
    apiFetch<{ address: string }>("/auth/session")
      .then(({ address }) => {
        if (cancelled) return;
        // A session for a *different* address than the currently
        // connected wallet is stale (e.g. the user switched accounts in
        // their wallet without logging out) — treat as unauthenticated
        // rather than silently trusting the old session.
        if (walletAddress && address.toLowerCase() !== walletAddress.toLowerCase()) {
          setState({ address: null, status: "idle", error: null });
          return;
        }
        setState({ address, status: "authenticated", error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ address: null, status: "idle", error: null });
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  // Clears the backend SIWE session when the wallet disconnects, however
  // that happens — not just a "Disconnect" button this app controls, but
  // also RainbowKit's own built-in account modal (WalletConnectButton.tsx
  // uses openAccountModal for that, which only calls Wagmi's disconnect()
  // — it has no idea this app also has its own /auth/logout session to
  // clear), the wallet extension's own disconnect action, or an account
  // switch that drops to zero accounts. Without this, the httpOnly
  // session cookie stayed valid after any of those, so reconnecting the
  // same wallet silently resumed "authenticated" with no fresh signature
  // — from the user's side, "Disconnect" appeared to do nothing.
  //
  // isConnectedRef tracks the previous render's value so this only fires
  // on a real true->false transition, not on cold mount (where
  // isConnected starts false for a never-connected visitor and there is
  // no session to clear).
  const isConnectedRef = useRef(isConnected);
  useEffect(() => {
    const wasConnected = isConnectedRef.current;
    isConnectedRef.current = isConnected;
    if (wasConnected && !isConnected) {
      apiFetch("/auth/logout", { method: "POST" }).catch(() => {
        // Same reasoning as signOut() below — logout is idempotent
        // server-side, a network error here shouldn't block clearing
        // local state.
      });
      setState({ address: null, status: "idle", error: null });
    }
  }, [isConnected]);

  const signIn = useCallback(async () => {
    if (!isConnected || !walletAddress) {
      setState((s) => ({ ...s, status: "error", error: "Connect a wallet first." }));
      return;
    }
    setState((s) => ({ ...s, status: "signing", error: null }));
    try {
      const { nonce } = await apiFetch<{ nonce: string }>("/auth/nonce", { method: "POST" });

      const siweMessage = new SiweMessage({
        domain: window.location.host,
        address: walletAddress,
        statement: "Sign in to the Decentralized Voting System.",
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce,
      });
      const message = siweMessage.prepareMessage();
      const signature = await signMessageAsync({ message });

      const { address } = await apiFetch<{ address: string }>("/auth/siwe", {
        method: "POST",
        body: { message, signature },
      });
      setState({ address, status: "authenticated", error: null });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Sign-in was cancelled or the signature could not be verified.";
      setState({ address: null, status: "error", error: message });
    }
  }, [isConnected, walletAddress, chainId, signMessageAsync]);

  const signOut = useCallback(async () => {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {
      // Logout is idempotent server-side (auth.routes.ts) — a network
      // error here still means the caller wants to be signed out
      // locally, so proceed to clear state regardless.
    });
    setState({ address: null, status: "idle", error: null });
  }, []);

  return { ...state, signIn, signOut };
}