import {
  DEFAULT_SERVER_SETTINGS,
  type EditorId,
  type MachineId,
  type MachineTheme,
  type ServerConfig,
  type ServerConfigStreamEvent,
  type ServerLifecycleLegacyThreadMigrationPayload,
  type ServerLifecycleWelcomePayload,
  type ServerProvider,
  type ServerSettings,
} from "@vekrel/contracts";
import {
  AVAILABLE_CONNECTION_STATE,
  presentMachineConnection,
  type MachinePresentation,
} from "@vekrel/client-runtime/connection";
import { createServerMachineAtoms } from "@vekrel/client-runtime/state/server";
import { createOutdatedServerUpdateCommand } from "@vekrel/client-runtime/state/outdatedServerUpdate";
import { createMachineServerConfigsAtom } from "@vekrel/client-runtime/state/shell";
import { mergeWithDefaultKeybindings } from "@vekrel/shared/keybindings";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { isConnectedWithConfig } from "../components/settings/scopedSettings";
import { machineCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { machineAtomList } from "./machineAtomList";
import { primaryMachineIdAtom } from "./primaryMachine";
import { machineSession } from "./session";
import { reuseProvidersIgnoringCheckedAt } from "./serverProviders.logic";

// Only the primary machine's themes are rendered, but which machine is primary changes
// at runtime and the subscription payload is fixed when it is established -- gating on "primary
// right now" would leave a newly promoted machine with no themes until it reconnected.
export const serverMachine = createServerMachineAtoms(connectionAtomRuntime, {
  initialConfigValueAtom: machineSession.initialConfigValueAtom,
  machineThemes: true,
  usageLimitSources: true,
  usageLimitsCommand: true,
});
export const machineUpdateStatesAtom = machineAtomList(
  "web-machine-update-states",
  serverMachine.updateStateAtom,
);
export const updateOutdatedServer = createOutdatedServerUpdateCommand(connectionAtomRuntime);
export const machineServerConfigsAtom = createMachineServerConfigsAtom({
  catalogValueAtom: machineCatalog.catalogValueAtom,
  serverConfigValueAtom: serverMachine.configValueAtom,
});

interface PrimaryServerState {
  readonly config: ServerConfig | null;
  readonly latestEvent: ServerConfigStreamEvent | null;
  readonly welcome: ServerLifecycleWelcomePayload | null;
}

const EMPTY_AVAILABLE_EDITORS: ReadonlyArray<EditorId> = [];
export const EMPTY_SERVER_PROVIDERS: ReadonlyArray<ServerProvider> = [];
const EMPTY_PRIMARY_SERVER_STATE: PrimaryServerState = {
  config: null,
  latestEvent: null,
  welcome: null,
};

const primaryServerStateAtom = Atom.make((get): PrimaryServerState => {
  const machineId = get(primaryMachineIdAtom);
  if (machineId === null) {
    return EMPTY_PRIMARY_SERVER_STATE;
  }

  const target = { machineId, input: {} };
  const configProjection = Option.getOrNull(
    AsyncResult.value(get(serverMachine.configProjection(target))),
  );
  const welcome = Option.getOrNull(AsyncResult.value(get(serverMachine.welcome(target))));

  return {
    config: get(serverMachine.configValueAtom(machineId)),
    latestEvent: configProjection?.latestEvent ?? null,
    welcome,
  };
}).pipe(Atom.withLabel("web-primary-server-state"));

export const primaryServerConfigAtom = Atom.make(
  (get): ServerConfig | null => get(primaryServerStateAtom).config,
).pipe(Atom.withLabel("web-primary-server-config"));

export const primaryServerConfigEventAtom = Atom.make(
  (get): ServerConfigStreamEvent | null => get(primaryServerStateAtom).latestEvent,
).pipe(Atom.withLabel("web-primary-server-config-event"));

export const primaryServerWelcomeAtom = Atom.make(
  (get): ServerLifecycleWelcomePayload | null => get(primaryServerStateAtom).welcome,
).pipe(Atom.withLabel("web-primary-server-welcome"));

export const primaryServerLegacyThreadMigrationAtom = Atom.make(
  (get): ServerLifecycleLegacyThreadMigrationPayload | null => {
    const machineId = get(primaryMachineIdAtom);
    if (machineId === null) {
      return null;
    }
    return Option.getOrNull(
      AsyncResult.value(get(serverMachine.legacyThreadMigration({ machineId, input: {} }))),
    );
  },
).pipe(Atom.withLabel("web-primary-server-legacy-thread-migration"));

export const primaryServerSettingsAtom = Atom.make(
  (get): ServerSettings => get(primaryServerConfigAtom)?.settings ?? DEFAULT_SERVER_SETTINGS,
).pipe(Atom.withLabel("web-primary-server-settings"));

export const primaryServerProvidersAtom = Atom.make(
  (get): ReadonlyArray<ServerProvider> =>
    get(primaryServerConfigAtom)?.providers ?? EMPTY_SERVER_PROVIDERS,
).pipe(Atom.withLabel("web-primary-server-providers"));

/** Without a primary, global shortcuts follow unscoped Settings. */
export function createShortcutKeybindingsAtom(input: {
  readonly primaryMachineIdAtom: Atom.Atom<MachineId | null>;
  readonly primaryConfigAtom: Atom.Atom<ServerConfig | null>;
  readonly machinesAtom: Atom.Atom<
    ReadonlyMap<MachineId, Pick<MachinePresentation, "connection" | "serverConfig">>
  >;
}) {
  // Selected before merging, so unrelated config updates keep the merged array.
  const customAtom = Atom.make((get) => {
    if (get(input.primaryMachineIdAtom) !== null) {
      // A primary stays authoritative while its config loads.
      return get(input.primaryConfigAtom)?.keybindings ?? null;
    }
    const machines = [...get(input.machinesAtom).values()];
    return machines.find(isConnectedWithConfig)?.serverConfig?.keybindings ?? null;
  });
  return Atom.make((get): ServerConfig["keybindings"] =>
    mergeWithDefaultKeybindings(get(customAtom) ?? []),
  );
}

// Settings' presentations import this module; mirror their catalog order and
// connection presentation here to avoid a cycle.
const machineConnectionsAtom = Atom.make((get) => {
  const machines = new Map<
    MachineId,
    Pick<MachinePresentation, "connection" | "serverConfig">
  >();
  for (const [machineId, entry] of get(machineCatalog.catalogValueAtom).entries) {
    const state = Option.getOrElse(
      AsyncResult.value(get(machineCatalog.stateAtom(machineId))),
      () => AVAILABLE_CONNECTION_STATE,
    );
    machines.set(machineId, {
      connection:
        entry.unsupportedReason === undefined
          ? presentMachineConnection(state)
          : { phase: "unsupported", error: entry.unsupportedReason, traceId: null },
      serverConfig: get(serverMachine.configValueAtom(machineId)),
    });
  }
  return machines;
});

export const primaryServerKeybindingsAtom = createShortcutKeybindingsAtom({
  primaryMachineIdAtom,
  primaryConfigAtom: primaryServerConfigAtom,
  machinesAtom: machineConnectionsAtom,
}).pipe(Atom.withLabel("web-primary-server-keybindings"));

export const primaryServerAvailableEditorsAtom = Atom.make(
  (get): ReadonlyArray<EditorId> =>
    get(primaryServerConfigAtom)?.availableEditors ?? EMPTY_AVAILABLE_EDITORS,
).pipe(Atom.withLabel("web-primary-server-available-editors"));

const EMPTY_MACHINE_THEMES: ReadonlyArray<MachineTheme> = [];

export const primaryServerMachineThemesAtom = Atom.make(
  (get): ReadonlyArray<MachineTheme> =>
    get(primaryServerConfigAtom)?.machineThemes ?? EMPTY_MACHINE_THEMES,
).pipe(Atom.withLabel("web-primary-server-machine-themes"));

/** Providers for views that do not show `checkedAt`; see {@link reuseProvidersIgnoringCheckedAt}. */
export const providersIgnoringCheckedAtAtom = Atom.family((machineId: MachineId) =>
  Atom.make((get): ReadonlyArray<ServerProvider> =>
    reuseProvidersIgnoringCheckedAt(
      Option.getOrNull(get.self<ReadonlyArray<ServerProvider>>()),
      get(serverMachine.providersValueAtom(machineId)) ?? EMPTY_SERVER_PROVIDERS,
    ),
  ).pipe(Atom.withLabel(`web-providers-ignoring-checked-at:${machineId}`)),
);
