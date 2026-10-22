import { resolveMachineKind } from "@vekrel/contracts";
import { useLocation } from "@tanstack/react-router";
import { CheckIcon, ChevronDownIcon, LayersIcon } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useMachines, type MachinePresentation } from "../../state/machines";
import { MachineIcon } from "../MachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { InlineButton } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { useOptionalSettingsScope } from "./SettingsScopeContext";
import { resolveSettingsScope, type SettingsScopeSearch } from "./settingsScope";
import {
  ALL_MACHINES_VALUE,
  ALL_PROJECTS_VALUE,
  machineAxisValue,
  projectAxisValue,
  projectScopeMenuGroups,
  selectMachineAxis,
  selectProjectAxis,
  settingsScopeMachineAddress,
  settingsScopeMachineLabel,
  settingsScopeMachineLabels,
  settingsScopeProjectMachines,
} from "./settingsScopeAxis";

export const SETTINGS_DEVICE_ONLY_PATHS: ReadonlySet<string> = new Set([
  "/settings/appearance",
  "/settings/snap-shot",
  "/settings/connections",
]);

interface SettingsScopeMenuProps {
  readonly value: SettingsScopeSearch;
  readonly groups: readonly SidebarProjectSnapshot[];
  readonly machines: readonly MachinePresentation[];
  readonly singleMachine: boolean;
  readonly onChange: (next: SettingsScopeSearch) => void;
}

export function SettingsScopeSentence() {
  const scope = useOptionalSettingsScope();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { machines } = useMachines();
  if (scope === null || SETTINGS_DEVICE_ONLY_PATHS.has(pathname)) return null;
  const props: SettingsScopeMenuProps = {
    value: scope.search,
    singleMachine: scope.singleMachine,
    groups: scope.groups,
    machines,
    onChange: scope.selectScope,
  };
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-3 text-base text-muted-foreground sm:px-4">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0">Applying settings for</span>
        <ProjectScopeMenu {...props} />
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0">
          {scope.search.machine || scope.scope.kind === "checkout" ? "on" : "across"}
        </span>
        <MachineScopeMenu {...props} />
      </span>
    </p>
  );
}

interface ScopeOption {
  value: string;
  label: string;
  secondary?: string;
  icon?: ReactNode;
  offline?: boolean;
}

function ScopeOptionLabel({ option }: { option: ScopeOption }) {
  return (
    <>
      {option.icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{option.label}</span>
        {option.secondary ? (
          <span className="block truncate text-xs text-muted-foreground">{option.secondary}</span>
        ) : null}
      </span>
      {option.offline ? (
        <span className="shrink-0 text-xs text-muted-foreground">Offline</span>
      ) : null}
    </>
  );
}

function ScopeMenu({
  ariaLabel,
  icon,
  label,
  value,
  options,
  allOption,
  searchLabel,
  onChange,
}: {
  ariaLabel: string;
  icon: ReactNode;
  label: string;
  value: string;
  options: ScopeOption[];
  allOption: ScopeOption | null;
  searchLabel: string;
  onChange: (next: string) => void;
}) {
  const [query, setQuery] = useState("");
  const Trigger = options.length > 6 ? ComboboxTrigger : MenuTrigger;
  const trigger = (
    <Trigger
      aria-label={`${ariaLabel}: ${label}`}
      render={<InlineButton tone="picker" />}
      className="min-w-0 max-w-72"
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </Trigger>
  );
  const choices = allOption ? [allOption, ...options] : options;
  if (options.length > 6) {
    const needle = query.trim().toLowerCase();
    const filteredItems = choices.filter((option) =>
      `${option.label} ${option.secondary ?? ""} ${option.value}`.toLowerCase().includes(needle),
    );
    return (
      <Combobox
        items={choices}
        filteredItems={filteredItems}
        filter={null}
        autoHighlight
        itemToStringLabel={(option) => option.label}
        isItemEqualToValue={(a, b) => a.value === b.value}
        value={choices.find((option) => option.value === value) ?? null}
        onOpenChange={(open) => {
          if (!open) setQuery("");
        }}
        onValueChange={(option) => {
          if (option) onChange(option.value);
        }}
      >
        {trigger}
        <ComboboxPopup align="start" className="w-80">
          <ComboboxSearchInput
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ComboboxEmpty>No matches found.</ComboboxEmpty>
          <ComboboxList>
            {(option: ScopeOption) => (
              <ComboboxItem key={option.value} value={option}>
                <ScopeOptionLabel option={option} />
                {option.value === value ? (
                  <CheckIcon aria-hidden className="size-3.5 shrink-0" />
                ) : null}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    );
  }
  return (
    <Menu>
      {trigger}
      <MenuPopup align="start">
        <div className="w-72 max-w-full">
          <MenuRadioGroup
            value={value}
            onValueChange={(next) => {
              if (typeof next === "string") onChange(next);
            }}
          >
            {choices.map((option, index) => (
              <Fragment key={option.value}>
                <MenuRadioItem value={option.value} closeOnClick>
                  <span className="flex min-w-0 items-center gap-2">
                    <ScopeOptionLabel option={option} />
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
                {index === 0 && allOption ? <MenuSeparator /> : null}
              </Fragment>
            ))}
          </MenuRadioGroup>
        </div>
      </MenuPopup>
    </Menu>
  );
}

function MachineScopeMenu({
  value,
  groups,
  machines,
  onChange,
  singleMachine,
}: SettingsScopeMenuProps) {
  const resolved = resolveSettingsScope(value, groups, machines);
  const machineValue = machineAxisValue(
    value,
    resolved.kind === "checkout" ? resolved.machineId : null,
  );
  const selected = machines.find(
    (machine) => machine.machineId === machineValue,
  );
  const project = groups.find((group) => group.projectKey === value.project);
  const memberMachineIds = project
    ? new Set(project.memberProjects.map((member) => member.machineId))
    : null;
  const options = memberMachineIds
    ? machines.filter((machine) => memberMachineIds.has(machine.machineId))
    : machines;
  return (
    <ScopeMenu
      ariaLabel="Machine scope"
      icon={
        selected ? (
          <MachineIcon
            aria-hidden
            kind={resolveMachineKind(selected.serverConfig)}
            className="size-3.5 shrink-0"
          />
        ) : null
      }
      label={
        selected
          ? settingsScopeMachineLabel(selected, machines)
          : machineValue !== ALL_MACHINES_VALUE
            ? "Unavailable machine"
            : singleMachine
              ? "No machines"
              : "All machines"
      }
      value={machineValue}
      onChange={(next) => onChange(selectMachineAxis(value, next))}
      searchLabel="Search machines"
      allOption={
        singleMachine
          ? null
          : {
              value: ALL_MACHINES_VALUE,
              label: "All machines",
              icon: <LayersIcon aria-hidden className="size-3.5 shrink-0" />,
            }
      }
      options={options.map((machine) => {
        const { primary, secondary } = settingsScopeMachineLabels(machine, machines);
        return {
          value: machine.machineId,
          label: primary,
          secondary:
            machines.length <= 1
              ? ""
              : secondary || settingsScopeMachineAddress(machine),
          icon: (
            <MachineIcon
              aria-hidden
              kind={resolveMachineKind(machine.serverConfig)}
              className="size-3.5 shrink-0"
            />
          ),
          offline: machine.connection.phase !== "connected",
        };
      })}
    />
  );
}

function ProjectScopeMenu({ value, groups, machines: allMachines, onChange }: SettingsScopeMenuProps) {
  const selected = groups.find((group) => group.projectKey === value.project);
  const projects = projectScopeMenuGroups(groups, value).map((group) => ({
    group,
    machines: settingsScopeProjectMachines(group, allMachines, true).join(", "),
  }));
  return (
    <ScopeMenu
      ariaLabel="Project scope"
      icon={selected ? <ProjectFavicon project={selected} className="size-3.5 shrink-0" /> : null}
      label={selected?.displayName ?? (value.project ? "Unavailable project" : "All projects")}
      value={projectAxisValue(value)}
      onChange={(next) => onChange(selectProjectAxis(value, next))}
      searchLabel="Search projects"
      allOption={{ value: ALL_PROJECTS_VALUE, label: "All projects" }}
      options={projects.map(({ group, machines }) => {
        const sameName = projects.filter(
          (other) =>
            other.group.projectKey !== group.projectKey &&
            other.group.displayName === group.displayName,
        );
        return {
          value: group.projectKey,
          label: group.displayName,
          secondary:
            sameName.length === 0
              ? allMachines.length > 1
                ? group.workspaceRoot
                : ""
              : sameName.some((other) => other.machines === machines)
                ? `${machines} · ${group.workspaceRoot}`
                : machines,
          icon: <ProjectFavicon project={group} className="size-3.5 shrink-0" />,
        };
      })}
    />
  );
}
