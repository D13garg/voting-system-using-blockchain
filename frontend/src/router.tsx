import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./components/layout/Layout.js";
import { RoleGuard } from "./components/RoleGuard.js";
import { Landing } from "./pages/Landing.js";
import { ElectionDetail } from "./pages/ElectionDetail.js";
import { VoterDashboard } from "./pages/VoterDashboard.js";
import { AdminDashboard } from "./pages/AdminDashboard.js";
import { CreateElection } from "./pages/CreateElection.js";
import { RegistrationRequests } from "./pages/RegistrationRequests.js";
import { ResultsArchive } from "./pages/ResultsArchive.js";

// RoleGuard (Section 9) now gates every /admin/* route (2026-07-13
// session) — its first real use. `/dashboard` (Voter Dashboard) does NOT
// use RoleGuard: it gates itself internally on connect/sign-in only, no
// role check, since any authenticated wallet is allowed to see its own
// data there.
export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Landing /> },
      { path: "elections/:id", element: <ElectionDetail /> },
      { path: "dashboard", element: <VoterDashboard /> },
      {
        path: "admin",
        element: (
          <RoleGuard>
            <AdminDashboard />
          </RoleGuard>
        ),
      },
      {
        path: "admin/elections/new",
        element: (
          <RoleGuard>
            <CreateElection />
          </RoleGuard>
        ),
      },
      {
        path: "admin/elections/:id/continue",
        element: (
          <RoleGuard>
            <CreateElection />
          </RoleGuard>
        ),
      },
      {
        path: "admin/registration-requests",
        element: (
          <RoleGuard>
            <RegistrationRequests />
          </RoleGuard>
        ),
      },
      { path: "archive", element: <ResultsArchive /> },
    ],
  },
]);
