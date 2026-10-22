import { useAtomValue } from "@effect/atom-react";
import type {
  DesktopPreviewBridge,
  DesktopPreviewWebviewConfig,
  MachineId,
} from "@vekrel/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";

import { previewBridge } from "~/components/preview/previewBridge";

const PREVIEW_CONFIG_STALE_TIME_MS = 5 * 60_000;
const PREVIEW_CONFIG_IDLE_TTL_MS = 10 * 60_000;

export class PreviewWebviewBridgeUnavailableError extends Schema.TaggedError<PreviewWebviewBridgeUnavailableError>()(
  "PreviewWebviewBridgeUnavailableError",
  { machineId: Schema.String },
) {
  override get message(): string {
    return `Desktop preview configuration is unavailable for machine "${this.machineId}".`;
  }
}

export class PreviewWebviewConfigLoadError extends Schema.TaggedError<PreviewWebviewConfigLoadError>()(
  "PreviewWebviewConfigLoadError",
  {
    machineId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to load desktop preview configuration for machine "${this.machineId}".`;
  }
}

export const PreviewWebviewConfigError = Schema.Union([
  PreviewWebviewBridgeUnavailableError,
  PreviewWebviewConfigLoadError,
]);
export type PreviewWebviewConfigError = typeof PreviewWebviewConfigError.Type;

type PreviewConfigBridge = Pick<DesktopPreviewBridge, "getPreviewConfig">;

const loadPreviewWebviewConfig = (
  machineId: MachineId,
  profileId?: string,
  bridge: PreviewConfigBridge | null = previewBridge,
): Effect.Effect<DesktopPreviewWebviewConfig, PreviewWebviewConfigError> => {
  if (bridge === null) {
    return Effect.fail(new PreviewWebviewBridgeUnavailableError({ machineId }));
  }

  return Effect.tryPromise({
    try: () => bridge.getPreviewConfig(machineId, profileId),
    catch: (cause) => new PreviewWebviewConfigLoadError({ machineId, cause }),
  });
};

/**
 * `Atom.family` keys on its argument, so the machine and profile are
 * folded into one string: passing an object would allocate a fresh entry on
 * every render.
 *
 * The profile is the tail rather than a second field, so an id containing the
 * delimiter round-trips whole instead of being truncated into a different
 * profile's key.
 */
const CONFIG_KEY_DELIMITER = "\u0000";

const configKey = (machineId: MachineId, profileId: string | undefined): string =>
  `${machineId}${CONFIG_KEY_DELIMITER}${profileId ?? ""}`;

const parseConfigKey = (key: string): { machineId: MachineId; profileId?: string } => {
  const delimiter = key.indexOf(CONFIG_KEY_DELIMITER);
  const machineId = (delimiter === -1 ? key : key.slice(0, delimiter)) as MachineId;
  const profileId = delimiter === -1 ? "" : key.slice(delimiter + CONFIG_KEY_DELIMITER.length);
  return {
    machineId,
    ...(profileId === "" ? {} : { profileId }),
  };
};

const previewWebviewConfigAtom = Atom.family((key: string) => {
  const { machineId, profileId } = parseConfigKey(key);
  return Atom.make(loadPreviewWebviewConfig(machineId, profileId)).pipe(
    Atom.swr({
      staleTime: PREVIEW_CONFIG_STALE_TIME_MS,
      revalidateOnMount: true,
    }),
    Atom.setIdleTTL(PREVIEW_CONFIG_IDLE_TTL_MS),
    Atom.withLabel(`preview:webview-config:${key}`),
  );
});

export function usePreviewWebviewConfig(
  machineId: MachineId,
  profileId?: string,
): DesktopPreviewWebviewConfig | null {
  const result = useAtomValue(previewWebviewConfigAtom(configKey(machineId, profileId)));
  return Option.getOrNull(AsyncResult.value(result));
}
