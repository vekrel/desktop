import type { ExecutionMachineDescriptor } from "@vekrel/contracts";
import * as Effect from "effect/Effect";

import { PrimaryMachineRequestError, retryTransientBootstrap } from "./auth";
import { PrimaryMachineHttpClient } from "./httpClient";

import { runPrimaryHttp } from "../../lib/runtime";

let primaryMachineDescriptor: ExecutionMachineDescriptor | null = null;
let primaryMachineDescriptorPromise: Promise<ExecutionMachineDescriptor> | null = null;

async function fetchPrimaryMachineDescriptor(): Promise<ExecutionMachineDescriptor> {
  return retryTransientBootstrap(async () => {
    let descriptor: ExecutionMachineDescriptor;
    try {
      descriptor = await runPrimaryHttp(
        PrimaryMachineHttpClient.pipe(Effect.flatMap((client) => client.metadata.descriptor())),
      );
    } catch (error) {
      throw PrimaryMachineRequestError.fromCause({
        operation: "fetch-machine-descriptor",
        cause: error,
      });
    }

    writePrimaryMachineDescriptor(descriptor);
    return descriptor;
  });
}

function readPrimaryMachineDescriptor(): ExecutionMachineDescriptor | null {
  return primaryMachineDescriptor;
}

function writePrimaryMachineDescriptor(
  descriptor: ExecutionMachineDescriptor | null,
): void {
  primaryMachineDescriptor = descriptor;
}

export function resolveInitialPrimaryMachineDescriptor(): Promise<ExecutionMachineDescriptor> {
  const descriptor = readPrimaryMachineDescriptor();
  if (descriptor) {
    return Promise.resolve(descriptor);
  }

  if (primaryMachineDescriptorPromise) {
    return primaryMachineDescriptorPromise;
  }

  const nextPromise = fetchPrimaryMachineDescriptor();
  primaryMachineDescriptorPromise = nextPromise;
  return nextPromise.finally(() => {
    if (primaryMachineDescriptorPromise === nextPromise) {
      primaryMachineDescriptorPromise = null;
    }
  });
}

export function resetPrimaryMachineDescriptorForTests(): void {
  primaryMachineDescriptorPromise = null;
  primaryMachineDescriptor = null;
}
