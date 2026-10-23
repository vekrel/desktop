import { type MachineId, VEKREL_PROJECT_FILE_NAME, type T3ProjectFile } from "@vekrel/contracts";
import { parseT3ProjectFile } from "@vekrel/shared/t3ProjectFile";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { createContext, type ReactNode, useContext } from "react";

import { useMachines, usePrimaryMachineId } from "../../state/machines";
import { getProjectFileQueryAtom, optimisticFileAtom } from "../files/projectFilesQueryState";
import { useSettingsProjectGroups } from "./useSettingsProjectGroups";
import { resolveScopedSettingsTargets, selectScopedSettingsMachines } from "./scopedSettings";
import { resolveSettingsScope, type SettingsScopeSearch } from "./settingsScope";
import { selectSingleMachineScope } from "./settingsScopeAxis";

type ProjectFileMember = readonly [
  machineId: MachineId,
  workspaceRoot: string,
  physicalProjectKey: string,
];

// Keyed by the members' identifying fields so each render reads the same atom.
const memberProjectFilesAtom = Atom.family((membersKey: string) => {
  const members = JSON.parse(membersKey) as ReadonlyArray<ProjectFileMember>;
  return Atom.make((get) => {
    const files = new Map<string, T3ProjectFile | null>();
    for (const [machineId, workspaceRoot, physicalProjectKey] of members) {
      const result = get(
        getProjectFileQueryAtom(machineId, workspaceRoot, VEKREL_PROJECT_FILE_NAME),
      );
      if (result.waiting) continue;
      const data =
        get(optimisticFileAtom(machineId, workspaceRoot, VEKREL_PROJECT_FILE_NAME))?.data ??
        Option.getOrNull(AsyncResult.value(result));
      files.set(
        physicalProjectKey,
        data === null || data.exists === false || data.truncated
          ? null
          : parseT3ProjectFile(data.contents),
      );
    }
    return files;
  }).pipe(Atom.withLabel(`web-settings-member-project-files:${membersKey}`));
});

function useMemberProjectFiles(scope: ReturnType<typeof resolveSettingsScope>) {
  const members = scope.kind === "project" || scope.kind === "checkout" ? scope.members : [];
  return useAtomValue(
    memberProjectFilesAtom(
      JSON.stringify(
        members.map((member): ProjectFileMember => [
          member.machineId,
          member.workspaceRoot,
          member.physicalProjectKey,
        ]),
      ),
    ),
  );
}

function useResolvedSettingsScope(rawSearch: SettingsScopeSearch, singleMachine: boolean) {
  const groups = useSettingsProjectGroups();
  const { machines: availableMachines } = useMachines();
  const primaryMachineId = usePrimaryMachineId();
  const search = singleMachine
    ? selectSingleMachineScope(
        rawSearch,
        resolveSettingsScope(rawSearch, groups, availableMachines),
        availableMachines,
        primaryMachineId,
      )
    : rawSearch;
  const scope = resolveSettingsScope(search, groups, availableMachines);
  const projectFiles = useMemberProjectFiles(scope);
  const selected = selectScopedSettingsMachines(scope, availableMachines, primaryMachineId);
  const targets = resolveScopedSettingsTargets(scope, selected.connectedMachines, projectFiles);
  const target =
    targets.find((candidate) => candidate.machineId === selected.machine?.machineId) ??
    targets[0] ??
    null;
  return { scope, groups, search, ...selected, targets, target };
}

const SettingsScopeContext = createContext<
  | (ReturnType<typeof useResolvedSettingsScope> & {
      singleMachine: boolean;
      search: SettingsScopeSearch;
      selectScope: (next: SettingsScopeSearch) => void;
    })
  | null
>(null);

export function SettingsScopeProvider({
  search,
  onChange,
  children,
  singleMachine = false,
}: {
  singleMachine?: boolean;
  search: SettingsScopeSearch;
  onChange: (next: SettingsScopeSearch) => void;
  children: ReactNode;
}) {
  const resolved = useResolvedSettingsScope(search, singleMachine);
  const value = { ...resolved, singleMachine, selectScope: onChange };
  return <SettingsScopeContext value={value}>{children}</SettingsScopeContext>;
}

export function useOptionalSettingsScope() {
  return useContext(SettingsScopeContext);
}

export function useSettingsScope() {
  const scope = useOptionalSettingsScope();
  if (scope === null) throw new Error("Settings scope must be read inside SettingsScopeProvider.");
  return scope;
}
