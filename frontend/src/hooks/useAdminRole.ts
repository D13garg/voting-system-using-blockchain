// GET /admin/me/role (admin.routes.ts) — RoleGuard's data source. Per
// this slice's approved decision, this goes through the backend (reusing
// requireRole's own OR-across-both-contracts check) rather than a direct
// on-chain read from the frontend, keeping "reads go through backend"
// consistent everywhere rather than carving out an exception for role
// checks specifically.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/apiClient.js";

export function useAdminRole(
  isAuthenticated: boolean,
): ReturnType<typeof useQuery<{ isElectionAdministrator: boolean }, Error>> {
  return useQuery({
    queryKey: ["admin-role"],
    queryFn: () => apiFetch<{ isElectionAdministrator: boolean }>("/admin/me/role"),
    enabled: isAuthenticated,
  });
}
