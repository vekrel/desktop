import { useAtomValue } from "@effect/atom-react";
import {
  EMPTY_V2_ITEM_SUPPORT,
  resolveV2ItemSupport,
  v2ItemSupportEqual,
  type V2ItemSupport,
} from "@vekrel/client-runtime/state/item-support";
import type { MachineId, ThreadId, TurnItemId } from "@vekrel/contracts";
import { scopeThreadRef } from "@vekrel/client-runtime/machine";
import { Atom } from "effect/reactivity";

import { machineThreadDetails } from "./threads";

function supportKey(input: {
  readonly machineId: MachineId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
}): string {
  return JSON.stringify(input);
}

function parseSupportKey(key: string): {
  readonly machineId: MachineId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
} {
  return JSON.parse(key) as {
    readonly machineId: MachineId;
    readonly threadId: ThreadId;
    readonly itemId: TurnItemId;
  };
}

const itemSupportAtomFamily = Atom.family((key: string) => {
  const target = parseSupportKey(key);
  const ref = scopeThreadRef(target.machineId, target.threadId);
  let previous = EMPTY_V2_ITEM_SUPPORT;
  return Atom.make((get): V2ItemSupport => {
    const scoped = get(machineThreadDetails.threadAtom(ref));
    if (scoped === null) return EMPTY_V2_ITEM_SUPPORT;
    const next = resolveV2ItemSupport(scoped.projection, target.itemId);
    if (v2ItemSupportEqual(previous, next)) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel(`web-v2-item-support:${key}`));
});

export function useV2ItemSupport(input: {
  readonly machineId: MachineId;
  readonly sourceThreadId: ThreadId;
  readonly sourceItemId: TurnItemId;
}): V2ItemSupport {
  return useAtomValue(
    itemSupportAtomFamily(
      supportKey({
        machineId: input.machineId,
        threadId: input.sourceThreadId,
        itemId: input.sourceItemId,
      }),
    ),
  );
}
