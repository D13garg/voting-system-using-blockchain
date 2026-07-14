import { Outlet } from "react-router-dom";
import { Header } from "./Header.js";

export function Layout(): JSX.Element {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <Header />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
