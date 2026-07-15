import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ArchiveElectionCard } from "./ArchiveElectionCard.js";
import * as useElectionResultsModule from "../hooks/useElectionResults.js";
import type { ElectionSummary } from "../hooks/useElections.js";

const election: ElectionSummary = {
  id: "mongo-id",
  electionId: 9,
  title: "Finalized Election",
  description: "",
  state: "result_finalized",
  createdBy: "0x1",
  createdAt: "2026-01-01",
};

function render_(): ReturnType<typeof render> {
  return render(<ArchiveElectionCard election={election} />, { wrapper: MemoryRouter });
}

describe("ArchiveElectionCard", () => {
  it("links to the election's detail page using the Mongo id", () => {
    vi.spyOn(useElectionResultsModule, "useElectionResults").mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useElectionResultsModule.useElectionResults>);
    render_();
    expect(screen.getByRole("link", { name: /Finalized Election/ })).toHaveAttribute(
      "href",
      "/elections/mongo-id",
    );
  });

  it("renders the results bar once results load", () => {
    vi.spyOn(useElectionResultsModule, "useElectionResults").mockReturnValue({
      data: { electionId: 9, totalVotes: 10, candidates: [{ candidateId: 1, name: "Alice", metadataURI: "", voteCount: 10 }] },
      isLoading: false,
    } as ReturnType<typeof useElectionResultsModule.useElectionResults>);
    render_();
    expect(screen.getByText("10 (100%)")).toBeInTheDocument();
  });
});
