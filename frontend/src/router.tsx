import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./components/layout/Layout.js";
import { Landing } from "./pages/Landing.js";
import { ElectionDetail } from "./pages/ElectionDetail.js";
import { VoterDashboard } from "./pages/VoterDashboard.js";
import { AdminDashboard } from "./pages/AdminDashboard.js";
import { CreateElection } from "./pages/CreateElection.js";
import { RegistrationRequests } from "./pages/RegistrationRequests.js";
import { ResultsArchive } from "./pages/ResultsArchive.js";

// RoleGuard (Section 9: redirects based on an on-chain role check) is
// deliberately NOT applied yet — every route below is reachable by any
// Guest for now. Wiring RoleGuard onto /admin/* and /dashboard is a later
// slice, once a real role-check hook exists (mirrors backend's Gap #1
// pattern: build the check, then gate routes with it, not the reverse).
export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Landing /> },
      { path: "elections/:id", element: <ElectionDetail /> },
      { path: "dashboard", element: <VoterDashboard /> },
      { path: "admin", element: <AdminDashboard /> },
      { path: "admin/elections/new", element: <CreateElection /> },
      { path: "admin/registration-requests", element: <RegistrationRequests /> },
      { path: "archive", element: <ResultsArchive /> },
    ],
  },
]);
