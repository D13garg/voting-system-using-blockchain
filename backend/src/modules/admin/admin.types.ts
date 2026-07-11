// Shared types for the Admin module (architecture Section 7.1: "role
// management, registration approval workflow, admin queries").
//
// SCOPE NOTE: "role management" (granting/revoking ELECTION_ADMINISTRATOR_
// ROLE/SYSTEM_ADMINISTRATOR_ROLE) is a System-Administrator-only, rare,
// on-chain AccessControl operation with no off-chain workflow around it
// at all (unlike registration, there's no "request" concept for roles)
// - it is not built here. This module's first cut is the registration
// approval workflow only (Section 14, steps 3-4).
//
// KEY DESIGN FACT (see admin.service.ts's header comment): VoterRegistry.sol
// has no concept of a "request" - registerVoter() is a direct
// admin-only on-chain call. The "registration request" modeled here is
// entirely an off-chain, backend-only workflow that exists to give
// admins a reviewable queue before they decide to spend gas confirming
// it on-chain - not a mirror of any on-chain state by itself.

export type RegistrationRequestStatus = "pending" | "approved" | "rejected";

/**
 * The API-facing shape of a registration request: the off-chain review
 * decision (source of truth: RegistrationRequestModel) merged with a
 * mirrored on-chain check of whether the admin's registerVoter() tx has
 * actually been submitted and confirmed yet - decision (a) continuation
 * (Admin module migration, see admin.service.ts's header comment):
 * sourced from IndexedVoterRegistration, not a live chain call.
 */
export interface RegistrationRequestSummary {
  id: string;
  electionId: number;
  voterAddress: string;
  status: RegistrationRequestStatus;
  /**
   * Whether the indexed mirror currently reports this wallet as
   * registered for this election (IndexedVoterRegistration.registered,
   * itself sourced from VoterRegistered/VoterRemoved events - see that
   * model's header comment). Can be true even if `status` is still
   * "pending" in a hypothetical out-of-band registration, and can be
   * false even when `status` is "approved" if the admin's wallet simply
   * hasn't submitted (or hasn't yet confirmed, or the worker hasn't yet
   * indexed) the actual registerVoter() transaction - these two fields
   * are deliberately independent, not one derived from the other.
   */
  onChainConfirmed: boolean;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}