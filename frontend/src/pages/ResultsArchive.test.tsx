import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ResultsArchive } from "./ResultsArchive.js";
import * as useElectionsModule from "../hooks/useElections.js";
import * as useElectionResultsModule from "../hooks/useElectionResults.js";
import type { ElectionSummary } from "../hooks/useElections.js";

function renderArchive(): ReturnType<typeof render> {
  return render(<ResultsArchive />, { wrapper: MemoryRouter });
}

function mockElections(overrides: Partial<ReturnType<typeof useElectionsModule.useElections>>): void {
  vi.spyOn(useElectionsModule, "useElections").mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useElectionsModule.useElections>);
}

describe("ResultsArchive", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.spyOn(useElectionResultsModule, "useElectionResults").mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof useElectionResultsModule.useElectionResults>);
  });

  it("shows a loading state while fetching", () => {
    mockElections({ isLoading: true });
    renderArchive();
    expect(screen.getByLabelText("Loading archive")).toBeInTheDocument();
  });

  it("shows an error state with retry", () => {
    mockElections({ isError: true });
    renderArchive();
    expect(screen.getByText(/Couldn't load the archive/)).toBeInTheDocument();
  });

  it("shows an empty state when nothing is finalized", () => {
    const elections: ElectionSummary[] = [
      { id: "1", electionId: 1, title: "Still active", description: "", state: "voting_active", createdBy: "0x1", createdAt: "2026-01-01" },
    ];
    mockElections({ data: elections });
    renderArchive();
    expect(screen.getByText(/No elections have been finalized/)).toBeInTheDocument();
  });

  it("shows only result_finalized elections, filtering out other states", () => {
    const elections: ElectionSummary[] = [
      { id: "1", electionId: 1, title: "Active one", description: "", state: "voting_active", createdBy: "0x1", createdAt: "2026-01-01" },
      { id: "2", electionId: 2, title: "Finalized one", description: "", state: "result_finalized", createdBy: "0x1", createdAt: "2026-01-01" },
    ];
    mockElections({ data: elections });
    renderArchive();
    expect(screen.getByText("Finalized one")).toBeInTheDocument();
    expect(screen.queryByText("Active one")).not.toBeInTheDocument();
  });
});
