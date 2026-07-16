// The signature design element from the Phase 4 design direction: the
// election lifecycle rendered as a connected ledger strip, reused
// everywhere an election's state appears (this card grid now; the
// Election Detail page later). See HANDOFF.md's Phase 4 section for the
// full design-decision record.
//
// SCOPE: 6 steps - all of architecture.md Section 16's 8-state model
// except "draft" and "voting_scheduled" (see election.types.ts's header
// comment on the backend for why voting_scheduled is folded into
// registration_closed rather than kept separate). "draft" isn't shown as
// a step either; this component is never rendered for a draft
// (useElections.ts filters those out before they reach here) — a strip
// with only one lit node would be a strange, sad first impression.
import type { ElectionLifecycleState } from "../hooks/useElections.js";

const STEPS: { state: ElectionLifecycleState; label: string }[] = [
  { state: "registration_open", label: "Registration" },
  { state: "registration_closed", label: "Scheduled" },
  { state: "voting_active", label: "Active" },
  { state: "voting_ended", label: "Ended" },
  { state: "result_finalized", label: "Finalized" },
  { state: "archived", label: "Archived" },
];

const STEP_INDEX: Record<string, number> = Object.fromEntries(STEPS.map((s, i) => [s.state, i]));

interface ElectionStateStripProps {
  state: ElectionLifecycleState;
}

export function ElectionStateStrip({ state }: ElectionStateStripProps): JSX.Element {
  const currentIndex = STEP_INDEX[state] ?? 0;

  return (
    <ol className="flex items-center" aria-label="Election lifecycle progress">
      {STEPS.map((step, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = index === currentIndex;
        // Finalized and Archived are the only steps that mean "confirmed,
        // done" — everywhere else, emerald must not appear (the
        // scaffold's own rule: confirmed color is reserved for
        // on-chain-confirmed state). A completed-but-not-finalized step
        // (e.g. "Scheduled" once voting is Active) is shown as ink, not
        // emerald — it happened, but it isn't itself a confirmation.
        const nodeState =
          (step.state === "result_finalized" || step.state === "archived") && (isComplete || isCurrent)
            ? "confirmed"
            : isCurrent
              ? "current"
              : isComplete
                ? "complete"
                : "upcoming";

        return (
          <li key={step.state} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={[
                  "h-2.5 w-2.5 rounded-full border-2",
                  nodeState === "confirmed" && "border-confirmed bg-confirmed",
                  nodeState === "current" && "border-accent bg-accent",
                  nodeState === "complete" && "border-ink bg-ink",
                  nodeState === "upcoming" && "border-border bg-surface",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-hidden
              />
              <span
                className={[
                  "text-[11px] leading-none",
                  isCurrent || nodeState === "confirmed" ? "font-medium text-ink" : "text-muted",
                ].join(" ")}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <span
                className={["mx-1.5 h-px flex-1", isComplete ? "bg-ink" : "bg-border"].join(" ")}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
