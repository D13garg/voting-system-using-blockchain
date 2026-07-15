import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DetailsStep } from "./DetailsStep.js";
import * as apiClient from "../../lib/apiClient.js";

function renderWithClient(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("DetailsStep", () => {
  afterEach(() => vi.restoreAllMocks());

  it("disables submit until a title is entered", () => {
    renderWithClient(<DetailsStep onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("creates a draft and calls onCreated with the new draft's id", async () => {
    vi.spyOn(apiClient, "apiFetch").mockResolvedValue({
      election: { id: "draft-123", electionId: null, title: "My Election", description: "", state: "draft", createdBy: "0x1", createdAt: "2026-01-01" },
    });
    const onCreated = vi.fn();
    renderWithClient(<DetailsStep onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My Election" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("draft-123"));
  });

  it("shows an error message if draft creation fails", async () => {
    vi.spyOn(apiClient, "apiFetch").mockRejectedValue(new Error("Something went wrong"));
    renderWithClient(<DetailsStep onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My Election" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Something went wrong")).toBeInTheDocument());
  });
});
