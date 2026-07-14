import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BallotForm } from "./BallotForm.js";
import type { CandidateSummary } from "../hooks/useCandidates.js";

const candidates: CandidateSummary[] = [
  { candidateId: 1, name: "Alice", metadataURI: "", bio: null, imageUrl: null },
  { candidateId: 2, name: "Bob", metadataURI: "", bio: null, imageUrl: null },
];

describe("BallotForm", () => {
  it("disables submit until a candidate is selected", () => {
    render(<BallotForm candidates={candidates} status="idle" error={null} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Cast vote" })).toBeDisabled();
  });

  it("enables submit and calls onSubmit with the selected candidateId", () => {
    const onSubmit = vi.fn();
    render(<BallotForm candidates={candidates} status="idle" error={null} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("Bob"));
    const button = screen.getByRole("button", { name: "Cast vote" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledWith(2);
  });

  it("shows signing/confirming status text and disables interaction", () => {
    render(<BallotForm candidates={candidates} status="signing" error={null} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Confirm in wallet…" })).toBeDisabled();
  });

  it("shows an error message when present", () => {
    render(<BallotForm candidates={candidates} status="error" error="Transaction reverted" onSubmit={vi.fn()} />);
    expect(screen.getByText("Transaction reverted")).toBeInTheDocument();
  });
});
