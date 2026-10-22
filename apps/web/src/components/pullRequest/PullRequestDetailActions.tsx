import type {
  MachineId,
  PullRequestAction,
  PullRequestMergeMethod,
  PullRequestUpdateMethod,
} from "@vekrel/contracts";
import { CheckIcon, ChevronDownIcon, FolderGit2Icon, GitBranchIcon, PlayIcon } from "lucide-react";
import type { ReactNode } from "react";

import { AnimatedWidth } from "~/components/AnimatedWidth";
import { cn } from "~/lib/utils";
import { MachineIcon } from "../MachineIcon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { resolvePullRequestPrimaryControl } from "./pullRequestDetail.logic";
import { PullRequestGlyph } from "./pullRequestIcons";
import type { resolvePullRequestState } from "./pullRequestPresentation";
import type { PickableMachine } from "./pullRequestProjectAssignment.logic";
import { useInlineActionConfirm } from "./useInlineActionConfirm";

export type PerformPullRequestAction = (
  action: PullRequestAction,
  method?: PullRequestMergeMethod,
  updateMethod?: PullRequestUpdateMethod,
) => Promise<boolean>;

export function ActOnMachinePicker({
  machines,
  value,
  onChange,
  disabled,
}: {
  machines: ReadonlyArray<PickableMachine>;
  value: MachineId;
  onChange: (machineId: MachineId) => void;
  disabled: boolean;
}) {
  return (
    <>
      <MenuSeparator />
      <MenuRadioGroup
        value={value}
        onValueChange={(machineId) => onChange(machineId as MachineId)}
      >
        {machines.map((machine) => (
          <MenuRadioItem
            key={machine.machineId}
            value={machine.machineId}
            disabled={disabled}
          >
            <span className="flex min-w-0 items-center gap-2">
              <MachineIcon
                kind={machine.machine ?? "server"}
                className="size-3.5 shrink-0"
              />
              <span className="truncate">{machine.label}</span>
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </>
  );
}

export function PullRequestCheckoutMenu({
  handoff,
  checkoutRoot,
  canPrepareWorktree,
  canCheckoutHere,
  onCheckout,
  pickableMachines,
  actingMachineId,
  onActingMachineChange,
}: {
  handoff: string | null;
  checkoutRoot: string | null;
  canPrepareWorktree: boolean;
  canCheckoutHere: boolean;
  onCheckout: (mode: "worktree" | "local") => void;
  pickableMachines: ReadonlyArray<PickableMachine>;
  actingMachineId: MachineId;
  onActingMachineChange: (machineId: MachineId) => void;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              disabled={handoff !== null || checkoutRoot === null}
              render={
                <Button
                  size="xs"
                  variant="outline"
                  aria-label={handoff?.startsWith("checkout") ? "Checking out..." : "Check out"}
                >
                  <GitBranchIcon aria-hidden className="size-3.5" />
                  <span className="@max-[35rem]/pr-header:hidden">
                    {handoff?.startsWith("checkout") ? "Checking out..." : "Check out"}
                  </span>
                  <ChevronDownIcon aria-hidden className="size-3.5 text-muted-foreground" />
                </Button>
              }
            />
          }
        />
        <TooltipPopup>Check out this pull request</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom">
        <MenuItem disabled={!canPrepareWorktree} onClick={() => onCheckout("worktree")}>
          <GitBranchIcon className="mt-1 size-3.5 shrink-0 self-start" />
          <span className="flex min-w-0 flex-col">
            <span>In a separate worktree</span>
            <span className="text-xs text-muted-foreground">
              Its own folder and thread. Nothing you have open moves.
            </span>
          </span>
        </MenuItem>
        <MenuItem disabled={!canCheckoutHere} onClick={() => onCheckout("local")}>
          <FolderGit2Icon className="mt-1 size-3.5 shrink-0 self-start" />
          <span className="flex min-w-0 flex-col">
            <span>In this repository</span>
            <span className="text-xs text-muted-foreground">
              Switches the branch you are working in, like `gh pr checkout`.
            </span>
          </span>
        </MenuItem>
        {pickableMachines.length > 0 ? (
          <ActOnMachinePicker
            machines={pickableMachines}
            value={actingMachineId}
            onChange={onActingMachineChange}
            disabled={handoff !== null}
          />
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

export function PullRequestResolveConflictsButton({
  handoff,
  unavailable,
  onResolve,
}: {
  handoff: string | null;
  unavailable: boolean;
  onResolve: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0">
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={handoff !== null || unavailable}
              onClick={onResolve}
              aria-label={handoff === "conflicts" ? "Preparing..." : "Resolve conflicts"}
            >
              <PullRequestGlyph.conflicting aria-hidden className="size-3.5" />
              <span className="@max-[30rem]/pr-header:hidden">
                {handoff === "conflicts" ? "Preparing..." : "Resolve conflicts"}
              </span>
            </Button>
          </span>
        }
      />
      <TooltipPopup side="top">
        {handoff === "conflicts" ? "Preparing..." : "Resolve conflicts"}
      </TooltipPopup>
    </Tooltip>
  );
}

/** The header's one prominent control, which depends on where the pull request stands. */
export function PullRequestPrimaryAction({
  pullRequestKey,
  primaryAction,
  autoMergeArmed,
  armedAutoMergeLabel,
  pendingAutoMergeLabel,
  selectedMergeMethod,
  selectedMergeMethodLabel,
  statePresentation,
  pendingAction,
  perform,
  resolveConflicts,
}: {
  pullRequestKey: string;
  primaryAction: ReturnType<typeof resolvePullRequestPrimaryControl> | null;
  autoMergeArmed: boolean;
  armedAutoMergeLabel: string;
  pendingAutoMergeLabel: string;
  selectedMergeMethod: PullRequestMergeMethod;
  selectedMergeMethodLabel: string;
  statePresentation: ReturnType<typeof resolvePullRequestState> | null;
  pendingAction: PullRequestAction | null;
  perform: PerformPullRequestAction;
  resolveConflicts: ReactNode;
}) {
  const inlineConfirm = useInlineActionConfirm(pullRequestKey);
  const actionPending = pendingAction !== null;
  return (
    <>
      {autoMergeArmed && primaryAction !== "auto-merge-armed" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge size="control" variant="info" role="img" aria-label={armedAutoMergeLabel}>
                <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                <span className="@max-[30rem]/pr-header:hidden">{armedAutoMergeLabel}</span>
              </Badge>
            }
          />
          <TooltipPopup side="top">
            {armedAutoMergeLabel}: the host will merge this on its own once its requirements are met
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {primaryAction === "resolve" ? (
        resolveConflicts
      ) : primaryAction === "ready" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex shrink-0">
                <Button
                  size="xs"
                  variant="default"
                  disabled={actionPending}
                  onClick={() => void perform("ready")}
                  aria-label="Ready for review"
                >
                  <PullRequestGlyph.pullRequest aria-hidden className="size-3.5" />
                  <span className="@max-[30rem]/pr-header:hidden">Ready for review</span>
                </Button>
              </span>
            }
          />
          <TooltipPopup side="top">Ready for review</TooltipPopup>
        </Tooltip>
      ) : primaryAction === "enable-auto-merge" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex shrink-0">
                <Button
                  size="xs"
                  variant="default"
                  disabled={actionPending}
                  {...inlineConfirm.props(
                    "enable-auto-merge",
                    () => void perform("enable-auto-merge", selectedMergeMethod),
                  )}
                  aria-label={
                    pendingAction === "enable-auto-merge"
                      ? "Enabling..."
                      : inlineConfirm.isArmed("enable-auto-merge")
                        ? "Confirm auto-merge?"
                        : pendingAutoMergeLabel
                  }
                >
                  {inlineConfirm.isArmed("enable-auto-merge") ? (
                    <CheckIcon aria-hidden className="size-3.5" />
                  ) : (
                    <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                  )}
                  <AnimatedWidth className="@max-[30rem]/pr-header:hidden">
                    <span className="grid">
                      <span aria-hidden className="invisible col-start-1 row-start-1">
                        {pendingAutoMergeLabel}
                      </span>
                      <span className="col-start-1 row-start-1">
                        {pendingAction === "enable-auto-merge"
                          ? "Enabling..."
                          : inlineConfirm.isArmed("enable-auto-merge")
                            ? "Confirm auto-merge?"
                            : pendingAutoMergeLabel}
                      </span>
                    </span>
                  </AnimatedWidth>
                </Button>
              </span>
            }
          />
          <TooltipPopup side="top">
            {pendingAction === "enable-auto-merge"
              ? "Enabling..."
              : inlineConfirm.isArmed("enable-auto-merge")
                ? "Confirm auto-merge?"
                : pendingAutoMergeLabel}
          </TooltipPopup>
        </Tooltip>
      ) : primaryAction === "auto-merge-armed" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge size="control" variant="info" role="img" aria-label={armedAutoMergeLabel}>
                <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                <span className="@max-[30rem]/pr-header:hidden">{armedAutoMergeLabel}</span>
              </Badge>
            }
          />
          <TooltipPopup side="top">
            {armedAutoMergeLabel}: the host will merge this on its own once its requirements are met
          </TooltipPopup>
        </Tooltip>
      ) : primaryAction === "merge" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex shrink-0">
                <Button
                  size="xs"
                  variant="default"
                  disabled={actionPending}
                  {...inlineConfirm.props(
                    "merge",
                    () => void perform("merge", selectedMergeMethod),
                  )}
                  aria-label={
                    pendingAction === "merge"
                      ? "Merging..."
                      : inlineConfirm.isArmed("merge")
                        ? "Confirm merge?"
                        : selectedMergeMethodLabel
                  }
                >
                  {inlineConfirm.isArmed("merge") ? (
                    <CheckIcon aria-hidden className="size-3.5" />
                  ) : (
                    <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                  )}
                  <AnimatedWidth className="@max-[30rem]/pr-header:hidden">
                    <span className="grid">
                      <span aria-hidden className="invisible col-start-1 row-start-1">
                        {selectedMergeMethodLabel}
                      </span>
                      <span className="col-start-1 row-start-1">
                        {pendingAction === "merge"
                          ? "Merging..."
                          : inlineConfirm.isArmed("merge")
                            ? "Confirm merge?"
                            : selectedMergeMethodLabel}
                      </span>
                    </span>
                  </AnimatedWidth>
                </Button>
              </span>
            }
          />
          <TooltipPopup side="top">
            {pendingAction === "merge"
              ? "Merging..."
              : inlineConfirm.isArmed("merge")
                ? "Confirm merge?"
                : selectedMergeMethodLabel}
          </TooltipPopup>
        </Tooltip>
      ) : (primaryAction === "merged" || primaryAction === "closed") &&
        statePresentation !== null ? (
        <Badge size="control" variant="outline">
          <span className={cn("flex items-center gap-1", statePresentation.toneClassName)}>
            <statePresentation.Icon className="size-3.5" />
            {statePresentation.label}
          </span>
        </Badge>
      ) : null}
    </>
  );
}

export function PullRequestApproveWorkflowsButton({
  pullRequestKey,
  pendingAction,
  perform,
}: {
  pullRequestKey: string;
  pendingAction: PullRequestAction | null;
  perform: PerformPullRequestAction;
}) {
  const inlineConfirm = useInlineActionConfirm(pullRequestKey);
  const actionPending = pendingAction !== null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="ml-auto inline-flex shrink-0">
            <Button
              size="xs"
              variant="warning-outline"
              disabled={actionPending}
              {...inlineConfirm.props("approve-workflows", () => void perform("approve-workflows"))}
              aria-label={
                pendingAction === "approve-workflows"
                  ? "Approving..."
                  : inlineConfirm.isArmed("approve-workflows")
                    ? "Confirm approve?"
                    : "Approve workflows to run"
              }
            >
              <PlayIcon aria-hidden className="size-3.5" />
              <span className="inline-grid">
                <span aria-hidden className="invisible col-start-1 row-start-1">
                  Approve workflows to run
                </span>
                <span aria-hidden className="invisible col-start-1 row-start-1">
                  Confirm approve?
                </span>
                <span className="col-start-1 row-start-1">
                  {pendingAction === "approve-workflows"
                    ? "Approving..."
                    : inlineConfirm.isArmed("approve-workflows")
                      ? "Confirm approve?"
                      : "Approve workflows to run"}
                </span>
              </span>
            </Button>
          </span>
        }
      />
      <TooltipPopup side="top">
        {pendingAction === "approve-workflows"
          ? "Approving..."
          : inlineConfirm.isArmed("approve-workflows")
            ? "Confirm approve?"
            : "Approve workflows to run"}
      </TooltipPopup>
    </Tooltip>
  );
}
