// Wagmi/RainbowKit provider config (architecture Section 4/9). Sepolia is
// listed first — it's the primary target per Section 19's Testnet/
// "Production" deployment architecture (both point at Sepolia); local
// Hardhat is included second, purely for local dev against a `hardhat
// node` instance, matching Section 19's Local Development entry.
//
// Wallet connection flow (Section 9): RainbowKit's ConnectButton handles
// "Connect → approve in wallet → read address/chain"; the "checks Sepolia,
// prompts switch if needed" step is RainbowKit's own built-in
// wrong-network UI, not custom code here.
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { hardhat, sepolia } from "wagmi/chains";

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;

if (!walletConnectProjectId) {
  // Loud, not silent — same "fail at startup, not at first wallet click"
  // principle as backend's env.ts. Vite's import.meta.env.DEV gate keeps
  // this from ever firing in a production build where the var is unset
  // for a genuinely different reason (misconfigured deploy, which should
  // fail differently/louder — see README once deployment docs land).
  if (import.meta.env.DEV) {
    console.warn(
      "VITE_WALLETCONNECT_PROJECT_ID is not set — copy frontend/.env.example to frontend/.env.local and fill in a real WalletConnect Cloud project ID. RainbowKit's WalletConnect/mobile wallet options will not work until this is set.",
    );
  }
}

export const wagmiConfig = getDefaultConfig({
  appName: "Decentralized Voting System",
  projectId: walletConnectProjectId ?? "dev-placeholder-project-id",
  chains: [sepolia, hardhat],
  ssr: false,
});
