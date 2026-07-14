import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultsBar } from "./ResultsBar.js";
import type { ElectionResults } from "../hooks/useElectionResults.js";

describe("ResultsBar", () => {
  it("sorts candidates by vote count, highest first", () => {
    const results: ElectionResults = {
      electionId: 1,
      totalVotes: 30,
      candidates: [
        { candidateId: 1, name: "Alice", metadataURI: "", voteCount: 10 },
        { candidateId: 2, name: "Bob", metadataURI: "", voteCount: 20 },
      ],
    };
    render(<ResultsBar results={results} />);
    const names = screen.getAllByText(/Alice|Bob/).map((el) => el.textContent);
    expect(names).toEqual(["Bob", "Alice"]);
  });

  it("computes percentages correctly", () => {
    const results: ElectionResults = {
      electionId: 1,
      totalVotes: 4,
      candidates: [
        { candidateId: 1, name: "Alice", metadataURI: "", voteCount: 1 },
        { candidateId: 2, name: "Bob", metadataURI: "", voteCount: 3 },
      ],
    };
    render(<ResultsBar results={results} />);
    expect(screen.getByText("3 (75%)")).toBeInTheDocument();
    expect(screen.getByText("1 (25%)")).toBeInTheDocument();
  });

  it("handles zero total votes without dividing by zero", () => {
    const results: ElectionResults = {
      electionId: 1,
      totalVotes: 0,
      candidates: [{ candidateId: 1, name: "Alice", metadataURI: "", voteCount: 0 }],
    };
    render(<ResultsBar results={results} />);
    expect(screen.getByText("0 (0%)")).toBeInTheDocument();
  });
});
