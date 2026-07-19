// Focused on the 2026-07-19 startTime-buffer fix - see LinkStep.tsx's
// header comment for the full reasoning. Not a full retest of the
// create/link flow itself (useCreateElectionOnChain/useLinkOnChain are
// covered by the handoff's own noted, deliberately-deferred gap around
// wagmi write-hook mocking) - just enough mocking of this component's
// two direct dependencies to prove the guard fires (or doesn't) before
// createElectionOnChain is ever called.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LinkStep } from "./LinkStep.js";
import { useChainId } from "wagmi";
import * as createHookModule from "../../hooks/useCreateElectionOnChain.js";
import * as linkHookModule from "../../hooks/useLinkOnChain.js";

vi.mock("wagmi", () => ({ useChainId: vi.fn() }));

function mockCreateHook(createElectionOnChain = vi.fn()): void {
    vi.mocked(useChainId).mockReturnValue(11155111);
    vi.spyOn(createHookModule, "useCreateElectionOnChain").mockReturnValue({
        createElectionOnChain,
        status: "idle",
        error: null,
        electionId: null,
        transactionHash: undefined,
    });
}

function mockLinkHook(): void {
    vi.spyOn(linkHookModule, "useLinkOnChain").mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
        error: null,
    } as unknown as ReturnType<typeof linkHookModule.useLinkOnChain>);
}

function fillAndSubmit(startTime: Date, endTime: Date): void {
    const toLocalInputValue = (d: Date): string => d.toISOString().slice(0, 16);
    fireEvent.change(screen.getByLabelText("Voting starts"), { target: { value: toLocalInputValue(startTime) } });
    fireEvent.change(screen.getByLabelText("Voting ends"), { target: { value: toLocalInputValue(endTime) } });
    fireEvent.click(screen.getByRole("button", { name: "Create on-chain" }));
}

describe("LinkStep - startTime buffer guard", () => {
    afterEach(() => vi.restoreAllMocks());

    it("blocks submission and shows a clear error when startTime is less than 30 minutes away", () => {
        const createElectionOnChain = vi.fn();
        mockCreateHook(createElectionOnChain);
        mockLinkHook();
        render(<LinkStep draftId="draft-1" title="Test Election" onLinked={vi.fn()} />);

        const now = Date.now();
        fillAndSubmit(new Date(now + 5 * 60 * 1000), new Date(now + 2 * 60 * 60 * 1000));

        expect(screen.getByText(/at least 30 minutes from now/)).toBeInTheDocument();
        expect(createElectionOnChain).not.toHaveBeenCalled();
    });

    it("allows submission through to createElectionOnChain when startTime leaves enough buffer", () => {
        const createElectionOnChain = vi.fn();
        mockCreateHook(createElectionOnChain);
        mockLinkHook();
        render(<LinkStep draftId="draft-1" title="Test Election" onLinked={vi.fn()} />);

        const now = Date.now();
        fillAndSubmit(new Date(now + 60 * 60 * 1000), new Date(now + 2 * 60 * 60 * 1000));

        expect(screen.queryByText(/at least 30 minutes from now/)).not.toBeInTheDocument();
        expect(createElectionOnChain).toHaveBeenCalledTimes(1);
    });
});