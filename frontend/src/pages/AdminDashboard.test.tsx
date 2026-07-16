import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminDashboard } from "./AdminDashboard.js";
import * as useRegistrationRequestsModule from "../hooks/useRegistrationRequests.js";
import * as useAdminElectionsModule from "../hooks/useAdminElections.js";
import type { ElectionSummary } from "../hooks/useElections.js";

function renderDashboard(): ReturnType<typeof render> {
  return render(<AdminDashboard />, { wrapper: MemoryRouter });
}

function mockPending(count: number, isLoading = false): void {
  vi.spyOn(useRegistrationRequestsModule, "useRegistrationRequests").mockReturnValue({
    data: Array.from({ length: count }),
    isLoading,
  } as ReturnType<typeof useRegistrationRequestsModule.useRegistrationRequests>);
}

function mockAdminElections(elections: ElectionSummary[], isLoading = false): void {
  vi.spyOn(useAdminElectionsModule, "useAdminElections").mockReturnValue({
    data: elections,
    isLoading,
  } as ReturnType<typeof useAdminElectionsModule.useAdminElections>);
}

describe("AdminDashboard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the pending registration count", () => {
    mockPending(3);
    mockAdminElections([]);
    renderDashboard();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows an empty message when nothing is in progress", () => {
    mockPending(0);
    mockAdminElections([]);
    renderDashboard();
    expect(screen.getByText(/No elections are mid-setup/)).toBeInTheDocument();
  });

  it("lists in-progress elections with the right status label", () => {
    mockPending(0);
    mockAdminElections([
      {
        id: "a",
        electionId: null,
        title: "Draft election",
        description: "",
        state: "draft",
        createdBy: "0x1",
        createdAt: "2026-01-01",
        registrationClosedAt: null,
        registrationClosedBy: null,
        archivedAt: null,
        archivedBy: null,
      },
      {
        id: "b",
        electionId: 2,
        title: "Needs candidates",
        description: "",
        state: "registration_open",
        createdBy: "0x1",
        createdAt: "2026-01-01",
        candidateCount: 1,
        registrationClosedAt: null,
        registrationClosedBy: null,
        archivedAt: null,
        archivedBy: null,
      },
      {
        id: "c",
        electionId: 3,
        title: "Already complete",
        description: "",
        state: "registration_open",
        createdBy: "0x1",
        createdAt: "2026-01-01",
        candidateCount: 2,
        registrationClosedAt: null,
        registrationClosedBy: null,
        archivedAt: null,
        archivedBy: null,
      },
    ]);
    renderDashboard();

    expect(screen.getByText("Draft election")).toBeInTheDocument();
    expect(screen.getByText("Not yet on-chain")).toBeInTheDocument();
    expect(screen.getByText("Needs candidates")).toBeInTheDocument();
    expect(screen.getByText("Needs more candidates")).toBeInTheDocument();
    expect(screen.queryByText("Already complete")).not.toBeInTheDocument();
  });
});
