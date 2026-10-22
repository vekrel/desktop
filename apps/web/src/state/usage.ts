import { useAtomValue } from "@effect/atom-react";
import {
  AuthDiagnosticsReadScope,
  USAGE_CONTRACT_VERSION,
  type MachineId,
  type UsageBucket,
  type UsageSummary,
  type UsageProviderKind,
  type UsageSummaryInput,
} from "@vekrel/contracts";
import { needsCursorKeychainAccess, refreshUsage } from "@vekrel/client-runtime/state/usage";
import { resolveUsageAccess } from "@vekrel/client-runtime/state/usage-access";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";

import { mergeUsage, type MachineUsage, type MergedUsage } from "@vekrel/shared/usageMerge";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { machinePresentations } from "./presentation";
import { serverMachine } from "./server";
import { machineSession, readMachineScope } from "./session";

export interface MachineUsageStatus {
  readonly machineId: MachineId;
  readonly label: string;
  readonly isPending: boolean;
  readonly canReadDiagnostics: boolean;
  readonly isConnected: boolean;
  readonly error: string | null;
  readonly summary: UsageSummary | null;
  readonly needsCursorKeychainAccess: boolean;
}

const usageByWindowAtom = Atom.family((windowKey: string) =>
  Atom.make((get): readonly MachineUsageStatus[] => {
    const input = JSON.parse(windowKey) as UsageSummaryInput;
    const presentations = get(machinePresentations.presentationsAtom);

    const statuses: MachineUsageStatus[] = [];
    for (const [machineId, presentation] of presentations) {
      const isConnected = presentation.connection.phase === "connected";
      const sessionResult = get(machineSession.sessionStateAtom(machineId));
      const access = resolveUsageAccess({
        connectionPhase: presentation.connection.phase,
        session: Option.getOrNull(AsyncResult.value(sessionResult)),
        hasSessionError: sessionResult._tag === "Failure",
      });
      if (!access.canReadDiagnostics) {
        statuses.push({
          machineId,
          label: presentation.entry.target.label,
          isConnected,
          ...access,
          summary: null,
          needsCursorKeychainAccess: false,
        });
        continue;
      }
      const result = get(serverMachine.usageSummary({ machineId, input }));
      const summary = Option.getOrNull(AsyncResult.value(result));
      statuses.push({
        machineId,
        label: presentation.entry.target.label,
        isPending: result.waiting,
        canReadDiagnostics: true,
        isConnected,
        error: result._tag === "Failure" ? "This machine could not report usage." : null,
        summary,
        needsCursorKeychainAccess: needsCursorKeychainAccess(
          summary,
          get(serverMachine.providersValueAtom(machineId)),
        ),
      });
    }
    return statuses;
  }).pipe(Atom.withLabel(`web-usage:window:${windowKey}`)),
);

export interface UsageView {
  readonly merged: MergedUsage;
  readonly machines: readonly MachineUsageStatus[];
  readonly selectedMachines: readonly MachineUsageStatus[];
  readonly isPending: boolean;
  readonly shown: { readonly window: UsageSummaryInput; readonly merged: MergedUsage } | null;
  readonly isPartial: boolean;
  readonly refresh: (input?: UsageSummaryInput) => Promise<void>;
}

export function mergeAnsweredUsage(
  machines: readonly MachineUsageStatus[],
  keepBucket?: (bucket: UsageBucket) => boolean,
): MergedUsage {
  const answered: MachineUsage[] = machines.flatMap(({ machineId, label, summary }) =>
    summary === null
      ? []
      : [
          {
            machineId,
            label,
            summary:
              keepBucket === undefined
                ? summary
                : { ...summary, buckets: summary.buckets.filter(keepBucket) },
          },
        ],
  );
  return mergeUsage(answered, USAGE_CONTRACT_VERSION);
}

const NO_HIDDEN_PROVIDERS: ReadonlySet<UsageProviderKind> = new Set();

function withoutProviders(
  machines: readonly MachineUsageStatus[],
  hiddenProviders: ReadonlySet<UsageProviderKind>,
): readonly MachineUsageStatus[] {
  if (hiddenProviders.size === 0) return machines;
  return machines.map((machine) =>
    machine.summary === null
      ? machine
      : {
          ...machine,
          summary: {
            ...machine.summary,
            buckets: machine.summary.buckets.filter(
              (bucket) => !hiddenProviders.has(bucket.provider),
            ),
            sources: machine.summary.sources.filter(
              (source) => !hiddenProviders.has(source.fingerprint.provider),
            ),
          },
        },
  );
}

function deriveSelection(
  machines: readonly MachineUsageStatus[],
  selectedMachineIds: ReadonlySet<MachineId> | null,
  hiddenProviders: ReadonlySet<UsageProviderKind>,
) {
  const selectedMachines =
    selectedMachineIds === null
      ? machines
      : machines.filter((machine) => selectedMachineIds.has(machine.machineId));
  return {
    machines,
    selectedMachineIds,
    hiddenProviders,
    selectedMachines,
    merged: mergeAnsweredUsage(withoutProviders(selectedMachines, hiddenProviders)),
  };
}

export function useUsage(
  input: UsageSummaryInput,
  selectedMachineIds: ReadonlySet<MachineId> | null = null,
  hiddenProviders: ReadonlySet<UsageProviderKind> = NO_HIDDEN_PROVIDERS,
): UsageView {
  const windowKey = JSON.stringify({
    sinceDay: input.sinceDay,
    untilDay: input.untilDay,
    timeZone: input.timeZone,
    resolution: input.resolution,
    sinceTime: input.sinceTime,
    untilTime: input.untilTime,
  });
  const atom = usageByWindowAtom(windowKey);
  const machines = useAtomValue(atom);
  // The render-time sync below compares merged by identity, so the derivation is
  // held in state keyed on its inputs rather than rebuilt every render.
  const [derived, setDerived] = useState(() =>
    deriveSelection(machines, selectedMachineIds, hiddenProviders),
  );
  let current = derived;
  if (
    derived.machines !== machines ||
    derived.selectedMachineIds !== selectedMachineIds ||
    derived.hiddenProviders !== hiddenProviders
  ) {
    current = deriveSelection(machines, selectedMachineIds, hiddenProviders);
    setDerived(current);
  }
  const { selectedMachines, merged } = current;

  const refresh = (nextInput?: UsageSummaryInput) =>
    refreshUsage({
      registry: appAtomRegistry,
      server: serverMachine,
      presentations: machinePresentations,
      machineIds: selectedMachines
        .filter(
          (machine) =>
            machine.canReadDiagnostics &&
            readMachineScope(machine.machineId, AuthDiagnosticsReadScope),
        )
        .map(({ machineId }) => machineId),
      input: nextInput ?? (JSON.parse(windowKey) as UsageSummaryInput),
    });

  const answeredCount = selectedMachines.filter(
    (machine) => machine.summary !== null,
  ).length;
  const stillReporting = selectedMachines.filter(
    (machine) => machine.summary === null && machine.error === null,
  ).length;
  const isPending = answeredCount === 0 && stillReporting > 0;

  const [lastAnswered, setLastAnswered] = useState<
    | (NonNullable<UsageView["shown"]> & {
        readonly selection: typeof selectedMachineIds;
        readonly hidden: typeof hiddenProviders;
      })
    | null
  >(null);
  if (
    answeredCount > 0 &&
    (lastAnswered?.merged !== merged ||
      lastAnswered.window !== input ||
      lastAnswered.selection !== selectedMachineIds ||
      lastAnswered.hidden !== hiddenProviders)
  ) {
    setLastAnswered({
      window: input,
      merged,
      selection: selectedMachineIds,
      hidden: hiddenProviders,
    });
  }
  const kept =
    lastAnswered?.selection === selectedMachineIds && lastAnswered.hidden === hiddenProviders
      ? lastAnswered
      : null;
  const shown =
    answeredCount > 0
      ? { window: input, merged }
      : (kept ?? (isPending ? null : { window: input, merged }));

  return {
    merged,
    machines,
    selectedMachines,
    isPending,
    shown,
    isPartial: answeredCount > 0 && stillReporting > 0,
    refresh,
  };
}
