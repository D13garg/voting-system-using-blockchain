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

function makeElection(overrides: Partial<ElectionSummary> & Pick<ElectionSummary, "id" | "electionId" | "title" | "state">): ElectionSummary {
  return {
    description: "",
    createdBy: "0x1",
    createdAt: "2026-01-01",
    registrationClosedAt: null,
    registrationClosedBy: null,
    archivedAt: null,
    archivedBy: null,
    ...overrides,
  };
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
      makeElection({ id: "1", electionId: 1, title: "Still active", state: "voting_active" }),
    ];
    mockElections({ data: elections });
    renderArchive();
    expect(screen.getByText(/No elections have been finalized/)).toBeInTheDocument();
  });

  it("shows result_finalized and archived elections, filtering out other states", () => {
    const elections: ElectionSummary[] = [
      makeElection({ id: "1", electionId: 1, title: "Active one", state: "voting_active" }),
      makeElection({ id: "2", electionId: 2, title: "Finalized one", state: "result_finalized" }),
      makeElection({ id: "3", electionId: 3, title: "Archived one", state: "archived" }),
    ];
    mockElections({ data: elections });
    renderArchive();
    expect(screen.getByText("Finalized one")).toBeInTheDocument();
    expect(screen.getByText("Archived one")).toBeInTheDocument();
    expect(screen.queryByText("Active one")).not.toBeInTheDocument();
  });
});
