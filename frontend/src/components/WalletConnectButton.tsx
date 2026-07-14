// Section 9: "WalletConnectButton". Uses RainbowKit's ConnectButton.Custom
// render prop rather than the default <ConnectButton /> chrome — the
// stock component brings its own visual language (rounded pill, its own
// font) that would sit outside this app's design tokens; Custom gives the
// connect/network-switch/account states with none of RainbowKit's own
// styling, so every pixel here is governed by tailwind.config.js's tokens.
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function WalletConnectButton(): JSX.Element {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        // RainbowKit needs a client-mount check to avoid a hydration
        // mismatch (this app is CSR-only per wagmiConfig.ts's ssr:false,
        // but the guard is cheap insurance and RainbowKit's own docs
        // recommend it unconditionally).
        const ready = mounted;
        const connected = ready && account && chain;

        if (!ready) {
          return <div className="h-9 w-32 animate-pulse rounded-md bg-border" aria-hidden />;
        }

        if (!connected) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              Connect wallet
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              type="button"
              onClick={openChainModal}
              className="inline-flex h-9 items-center rounded-md bg-danger px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Wrong network
            </button>
          );
        }

        return (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openChainModal}
              className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-xs text-muted transition-colors hover:text-ink"
            >
              {chain.name}
            </button>
            <button
              type="button"
              onClick={openAccountModal}
              className="font-chain-data inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm text-ink transition-colors hover:border-accent"
            >
              {account.displayName}
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
