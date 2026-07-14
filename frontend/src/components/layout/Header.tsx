import { NavLink } from "react-router-dom";
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
