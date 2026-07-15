import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CreateElection } from "./CreateElection.js";
import * as useElectionModule from "../hooks/useElection.js";
import type { ElectionSummary } from "../hooks/useElections.js";

// Isolate the orchestrator's branching logic from each step's own
// (heavily wagmi-dependent) internals — those are exercised by each
// step's own future tests, not duplicated here.
vi.mock("../components/create-election/DetailsStep.js", () => ({
  DetailsStep: () => <div>details-step</div>,
}));
vi.mock("../components/create-election/LinkStep.js", () => ({
  LinkStep: () => <div>link-step</div>,
}));
vi.mock("../components/create-election/CandidatesStep.js", () => ({
  CandidatesStep: () => <div>candidates-step</div>,
}));

function renderAt(path: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/elections/new" element={<CreateElection />} />
        <Route path="/admin/elections/:id/continue" element={<CreateElection />} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockElection(data: Partial<ElectionSummary> | undefined, overrides: Partial<ReturnType<typeof useElectionModule.useElection>> = {}): void {
  vi.spyOn(useElectionModule, "useElection").mockReturnValue({
    data: data as ElectionSummary | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useElectionModule.useElection>);
}

describe("CreateElection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows DetailsStep with no draft id in the URL", () => {
    renderAt("/admin/elections/new");
    expect(screen.getByText("details-step")).toBeInTheDocument();
  });

  it("shows LinkStep for a draft not yet on-chain (electionId: null)", () => {
    mockElection({ id: "d1", electionId: null, title: "T", candidateCount: undefined });
    renderAt("/admin/elections/d1/continue");
    expect(screen.getByText("link-step")).toBeInTheDocument();
  });

  it("shows CandidatesStep for a linked election below the minimum candidate count", () => {
    mockElection({ id: "d1", electionId: 5, title: "T", candidateCount: 1 });
    renderAt("/admin/elections/d1/continue");
    expect(screen.getByText("candidates-step")).toBeInTheDocument();
  });

  it("shows the completion message once the minimum candidate count is met", () => {
    mockElection({ id: "d1", electionId: 5, title: "T", candidateCount: 2 });
    renderAt("/admin/elections/d1/continue");
    expect(screen.getByText("This election is ready.")).toBeInTheDocument();
  });

  it("shows a not-found message if the draft doesn't exist", () => {
    mockElection(undefined, { isError: true });
    renderAt("/admin/elections/missing/continue");
    expect(screen.getByText(/Couldn't find that draft/)).toBeInTheDocument();
  });
});
