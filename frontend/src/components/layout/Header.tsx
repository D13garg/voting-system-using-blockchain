import { NavLink } from "react-router-dom";
import { useAccount } from "wagmi";
import { useAuth } from "../../hooks/useAuth.js";
import { useAdminRole } from "../../hooks/useAdminRole.js";
import { WalletConnectButton } from "../WalletConnectButton.js";
import { WalletStatusBadge } from "../WalletStatusBadge.js";
import { ThemeToggle } from "../ThemeToggle.js";

const NAV_LINKS = [
  { to: "/", label: "Elections" },
  { to: "/archive", label: "Archive" },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    "text-sm transition-colors",
    isActive ? "text-ink font-medium" : "text-muted hover:text-ink",
  ].join(" ");
}

export function Header(): JSX.Element {
  const { isConnected } = useAccount();
  const { status: authStatus } = useAuth();
  const isAuthenticated = authStatus === "authenticated";
  const { data: adminRole } = useAdminRole(isAuthenticated);

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <NavLink to="/" className="font-display text-lg font-semibold tracking-tight text-ink">
            Ledger<span className="text-accent">Vote</span>
          </NavLink>
          <nav className="hidden items-center gap-6 sm:flex">
            {NAV_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} className={navLinkClass} end={link.to === "/"}>
                {link.label}
              </NavLink>
            ))}
            {isConnected && (
              <NavLink to="/dashboard" className={navLinkClass}>
                Dashboard
              </NavLink>
            )}
            {/* Hidden entirely, not just link-disabled, for wallets
                without the role — RoleGuard is still the real
                enforcement if someone navigates here directly, this is
                purely about not showing a link that would just deny
                them. */}
            {adminRole?.isElectionAdministrator && (
              <NavLink to="/admin" className={navLinkClass}>
                Admin
              </NavLink>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <WalletStatusBadge />
          <WalletConnectButton />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
