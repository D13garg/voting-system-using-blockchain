import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Landing } from "./Landing.js";
import * as useElectionsModule from "../hooks/useElections.js";
import type { ElectionSummary } from "../hooks/useElections.js";

function renderLanding(): ReturnType<typeof render> {
  return render(<Landing />, { wrapper: MemoryRouter });
}

function mockElections(
  overrides: Partial<ReturnType<typeof useElectionsModule.useElections>>,
): void {
  vi.spyOn(useElectionsModule, "useElections").mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useElectionsModule.useElections>);
}

describe("Landing", () => {
  it("shows a loading skeleton while fetching", () => {
    mockElections({ isLoading: true });
    renderLanding();
    expect(screen.getByLabelText("Loading elections")).toBeInTheDocument();
  });

  it("shows an error state with a retry action on failure", () => {
    mockElections({ isError: true });
    renderLanding();
    expect(screen.getByText(/Couldn't load elections/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows an empty state when there are no elections", () => {
    mockElections({ data: [] });
    renderLanding();
    expect(screen.getByText(/No elections have been created/)).toBeInTheDocument();
  });

  it("renders 'Active now' before 'Upcoming' regardless of data order (user's approved grouping)", () => {
    const elections: ElectionSummary[] = [
      { id: "1", electionId: 1, title: "Future one", description: "", state: "voting_scheduled", createdBy: "0x1", createdAt: "2026-01-01" },
      { id: "2", electionId: 2, title: "Live one", description: "", state: "voting_active", createdBy: "0x1", createdAt: "2026-01-01" },
    ];
    mockElections({ data: elections });
    renderLanding();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    const activeIndex = headings.findIndex((h) => h?.includes("Active now"));
    const upcomingIndex = headings.findIndex((h) => h?.includes("Upcoming"));
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    expect(activeIndex).toBeLessThan(upcomingIndex);
  });
});
