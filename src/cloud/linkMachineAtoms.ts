import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@vekrel/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";
import {
  linkPrimaryMachineToCloud,
  type CloudLinkMode,
  type CloudLinkTarget,
  unlinkPrimaryMachineFromCloud,
  updatePrimaryCloudPreferences,
} from "./linkMachine";

const cloudLinkScheduler = createAtomCommandScheduler();
const cloudLinkConcurrency = {
  mode: "serial" as const,
  key: (input: { readonly target: CloudLinkTarget }) => input.target.machineId,
};

export const linkPrimaryMachine = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:cloud:link-primary-machine",
  scheduler: cloudLinkScheduler,
  concurrency: cloudLinkConcurrency,
  execute: (input: {
    readonly target: CloudLinkTarget;
    readonly clerkToken: string;
    readonly mode?: CloudLinkMode;
  }) => linkPrimaryMachineToCloud(input),
});

export const unlinkPrimaryMachine = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:cloud:unlink-primary-machine",
  scheduler: cloudLinkScheduler,
  concurrency: cloudLinkConcurrency,
  execute: (input: { readonly target: CloudLinkTarget; readonly clerkToken: string | null }) =>
    unlinkPrimaryMachineFromCloud(input),
});

export const updatePrimaryMachinePreferences = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:cloud:update-primary-machine-preferences",
  scheduler: cloudLinkScheduler,
  concurrency: cloudLinkConcurrency,
  execute: (input: {
    readonly target: CloudLinkTarget;
    readonly publishAgentActivity: boolean;
    readonly holdWebhooksWhileOffline?: boolean;
  }) => updatePrimaryCloudPreferences(input),
});
