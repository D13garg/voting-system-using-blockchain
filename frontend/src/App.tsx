// Phase 4 (Frontend — core flows) entrypoint. Replaces the Phase 1
// placeholder. Provider order matters: Wagmi must wrap RainbowKit (its
// hooks), React Query must wrap Wagmi (Wagmi v2's own internal caching
// dependency), RainbowKit must wrap the router (its modals use React
// context that needs to be available wherever WalletConnectButton is
// rendered, i.e. inside Layout/Header).
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { RouterProvider } from "react-router-dom";
import "@rainbow-me/rainbowkit/styles.css";

import { wagmiConfig } from "./lib/wagmiConfig.js";
import { router } from "./router.js";
import { useThemeStore } from "./stores/themeStore.js";

const queryClient = new QueryClient();

// RainbowKit ships its own theme system, separate from our Tailwind
// tokens (its modal is rendered outside the app's normal DOM styling
// scope). Mapped here to our accent/surface colors so the connect modal
// doesn't look like a different product — everything else in the app
// uses WalletConnectButton's ConnectButton.Custom render instead, which
// bypasses RainbowKit's styling entirely (see that file's header
// comment); this theme only affects RainbowKit's own popup modals
// (connect wallet picker, account modal, chain switcher).
const rainbowLight = lightTheme({ accentColor: "#4F46E5", accentColorForeground: "#FFFFFF", borderRadius: "medium" });
const rainbowDark = darkTheme({ accentColor: "#6C6FF0", accentColorForeground: "#FFFFFF", borderRadius: "medium" });

export default function App(): JSX.Element {
  const theme = useThemeStore((s) => s.theme);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme === "dark" ? rainbowDark : rainbowLight}>
          <RouterProvider router={router} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
