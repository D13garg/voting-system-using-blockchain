import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ElectionStateStrip } from "./ElectionStateStrip.js";

describe("ElectionStateStrip", () => {
  it("renders exactly the 4 backend-reportable steps (not Section 16's full 8-state model)", () => {
    render(<ElectionStateStrip state="voting_active" />);
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.getByText("Finalized")).toBeInTheDocument();
  });

  it("marks the current step distinctly from upcoming steps", () => {
    render(<ElectionStateStrip state="voting_active" />);
    const activeLabel = screen.getByText("Active");
    const scheduledLabel = screen.getByText("Ended");
    expect(activeLabel.className).toContain("text-ink");
    expect(scheduledLabel.className).toContain("text-muted");
  });

  it("has an accessible label for the overall progress list", () => {
    render(<ElectionStateStrip state="result_finalized" />);
    expect(screen.getByRole("list", { name: "Election lifecycle progress" })).toBeInTheDocument();
  });
});
