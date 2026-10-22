import { ComposerSelectControl } from "./chat/ComposerControl";
import { ComposerContextLabel } from "./ComposerContextLabel";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import { useAtomValue } from "@effect/atom-react";
import { shortcutLabelForCommand } from "../keybindings";
import { primaryServerKeybindingsAtom } from "../state/server";
import type { MachineId } from "@vekrel/contracts";
import { PlusIcon, ScaleIcon } from "lucide-react";
import { memo } from "react";

import { ADD_TO_MACHINE_LABEL_CLASS, type MachineOption } from "./BranchToolbar.logic";
import { MachineIcon } from "./MachineIcon";
import { useComposerMenuProps } from "./chat/composerEventScope";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectValue,
} from "./ui/select";

interface BranchToolbarMachineSelectorProps {
  autoMachineLabel?: string | undefined;
  onAutoMachine?: (() => void) | undefined;
  envLocked: boolean;
  machineId: MachineId;
  availableMachines: readonly MachineOption[];
  onMachineChange?: (machineId: MachineId) => void;
  onAddToMachine?: (() => void) | undefined;
}

// Action values cannot collide with server-minted machine IDs.
const AUTO_VALUE = "action:auto";
const ADD_MACHINE_VALUE = "action:add-machine";
const machineValue = (id: MachineId) => `env:${id}`;

export const BranchToolbarMachineSelector = memo(function BranchToolbarMachineSelector({
  autoMachineLabel,
  onAutoMachine,
  envLocked,
  machineId,
  availableMachines,
  onMachineChange,
  onAddToMachine,
}: BranchToolbarMachineSelectorProps) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const shortcutLabel = shortcutLabelForCommand(
    useAtomValue(primaryServerKeybindingsAtom),
    "composer.host",
  );
  const activeMachine =
    availableMachines.find((env) => env.machineId === machineId) ?? null;

  const machineItems = [
    ...(onAutoMachine
      ? [{ value: AUTO_VALUE, label: autoMachineLabel ?? "Auto balance" }]
      : []),
    ...availableMachines.map((env) => ({
      value: machineValue(env.machineId),
      label: env.label,
    })),
    ...(onAddToMachine ? [{ value: ADD_MACHINE_VALUE, label: "Add to another machine" }] : []),
  ];

  // The static label carries the xs control's height (h-7 sm:h-6) as well as
  // its padding: the composer context strip has no min-height of its own, and
  // the glass seam joining it to the composer assumes a fixed strip height, so
  // a shorter label would drag the seam out of line whenever this label is the
  // only thing in the strip.
  if (envLocked || (onMachineChange === undefined && onAddToMachine === undefined)) {
    const lockedRow = (
      <span
        className="inline-flex h-7 min-w-0 max-w-full items-center gap-1 border border-transparent px-1.75 font-normal text-muted-foreground/70 text-xs sm:h-6"
        data-composer-context-control
      >
        <MachineIcon
          kind={activeMachine?.machine ?? "server"}
          className="size-3 shrink-0"
        />
        <ComposerContextLabel>{activeMachine?.label ?? "Run on"}</ComposerContextLabel>
      </span>
    );
    return (
      <Tooltip>
        <TooltipTrigger render={lockedRow} />
        <TooltipPopup>{activeMachine?.label ?? "Run on"}</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Select
      modal={false}
      value={autoMachineLabel ? AUTO_VALUE : machineValue(machineId)}
      onValueChange={(value) => {
        if (value === ADD_MACHINE_VALUE) {
          onAddToMachine?.();
        } else if (value === AUTO_VALUE) {
          onAutoMachine?.();
        } else if (value?.startsWith("env:")) {
          onMachineChange?.(value.slice(4) as MachineId);
        }
      }}
      items={machineItems}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerSelectControl
              size="xs"
              className="min-w-0 max-w-full"
              aria-label="Run on"
              data-composer-shortcut="composer.host"
              data-composer-context-control
            />
          }
        >
          {autoMachineLabel ? (
            <ScaleIcon className="size-3 shrink-0" aria-hidden="true" />
          ) : (
            <MachineIcon
              kind={activeMachine?.machine ?? "server"}
              className="size-3 shrink-0"
            />
          )}
          <ComposerContextLabel>
            <SelectValue />
          </ComposerContextLabel>
        </TooltipTrigger>
        <TooltipPopup>
          {autoMachineLabel ?? activeMachine?.label ?? "Run on"}
          {shortcutLabel ? ` · ${shortcutLabel}` : null}
        </TooltipPopup>
      </Tooltip>
      <SelectPopup alignItemWithTrigger={false} {...composerFloatingLayerProps}>
        <SelectGroup>
          <SelectGroupLabel>Run on</SelectGroupLabel>
          {onAutoMachine && (
            <SelectItem
              value={AUTO_VALUE}
              onClick={() => {
                if (autoMachineLabel) onAutoMachine?.();
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <ScaleIcon className="size-3" aria-hidden="true" />
                {autoMachineLabel ?? "Auto balance"}
              </span>
            </SelectItem>
          )}
          {availableMachines.map((env) => (
            <SelectItem
              key={env.machineId}
              value={machineValue(env.machineId)}
              disabled={onMachineChange === undefined && env.machineId !== machineId}
            >
              <span className="inline-flex items-center gap-1.5">
                <MachineIcon kind={env.machine} className="size-3" />
                {env.label}
              </span>
            </SelectItem>
          ))}
          {onAddToMachine ? (
            <SelectItem value={ADD_MACHINE_VALUE}>
              <span className={ADD_TO_MACHINE_LABEL_CLASS}>
                <PlusIcon aria-hidden="true" className="size-3" />
                Add to another machine
              </span>
            </SelectItem>
          ) : null}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
