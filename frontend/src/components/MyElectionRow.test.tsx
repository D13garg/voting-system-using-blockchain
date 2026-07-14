import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MyElectionRow } from "./MyElectionRow.js";
import type { MyElectionStatus } from "../hooks/useMyElections.js";

function renderRow(election: MyElectionStatus): ReturnType<typeof render> {
  return render(<MyElectionRow election={election} />, { wrapper: MemoryRouter });
}

const base: MyElectionStatus = {
  id: "mongo-id-123",
  electionId: 7,
  title: "Test Election",
  state: "voting_active",
  registrationStatus: "not_requested",
  onChainConfirmed: false,
  hasVoted: false,
};

describe("MyElectionRow", () => {
  it("links to /elections/:id using the Mongo id, NOT the on-chain electionId", () => {
    renderRow(base);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/elections/mongo-id-123");
  });

  it("shows 'Registered' when onChainConfirmed is true, regardless of status", () => {
    renderRow({ ...base, registrationStatus: "pending", onChainConfirmed: true });
    expect(screen.getByText("Registered")).toBeInTheDocument();
  });

  it("shows a distinct notice for approved-but-not-yet-confirmed", () => {
    renderRow({ ...base, registrationStatus: "approved", onChainConfirmed: false });
    expect(screen.getByText("Approved, awaiting confirmation")).toBeInTheDocument();
  });

  it("shows a 'Voted' badge when hasVoted is true", () => {
    renderRow({ ...base, hasVoted: true });
    expect(screen.getByText("Voted")).toBeInTheDocument();
  });
});
