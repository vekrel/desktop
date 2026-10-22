import type { ScopedThreadRef } from "@vekrel/contracts";
import { isAtomCommandInterrupted } from "@vekrel/client-runtime/state/runtime";
import * as Schema from "effect/Schema";

import {
  browserDefaultOpenProfileId,
  browserDefaultOpenViewport,
  resolveBrowserDefaults,
} from "~/browser/browserDefaults";
import { isWebUrl, resolveBrowserLinkTargetPreference } from "~/browser/browserLinkTarget";
import type { OpenPreviewMutation } from "~/browser/openFileInPreview";
import { isPreviewAvailableFor, previewRuntimeFor } from "~/browser/previewRuntime";
import { recordVisitForThread } from "~/browserHistoryStore";
import { applyPreviewServerSnapshot } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";

const terminalLinkErrorContext = {
  machineId: Schema.String,
  threadId: Schema.String,
  targetOrigin: Schema.String,
  cause: Schema.Defect(),
};

export class TerminalLinkPreviewOpenError extends Schema.TaggedError<TerminalLinkPreviewOpenError>()(
  "TerminalLinkPreviewOpenError",
  terminalLinkErrorContext,
) {
  override get message(): string {
    return `Failed to open terminal link ${this.targetOrigin} in preview for thread ${this.threadId}.`;
  }
}

interface OpenTerminalLinkInPreviewInput<E> {
  readonly url: string;
  readonly threadRef: ScopedThreadRef;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly fallbackToBrowser: () => void;
  readonly forceBrowser: boolean;
}

export async function openTerminalLinkInPreview<E>(
  input: OpenTerminalLinkInPreviewInput<E>,
): Promise<void> {
  const supportsPreview =
    !input.forceBrowser &&
    isWebUrl(input.url) &&
    isPreviewAvailableFor(input.threadRef.machineId) &&
    input.threadRef.threadId.length > 0 &&
    (await resolveBrowserLinkTargetPreference()) === "app";

  if (!supportsPreview) {
    input.fallbackToBrowser();
    return;
  }

  const errorContext = {
    machineId: input.threadRef.machineId,
    threadId: input.threadRef.threadId,
    targetOrigin: new URL(input.url).origin,
  };

  const defaults = await resolveBrowserDefaults();
  const runtime = previewRuntimeFor(input.threadRef.machineId);
  const result = await input.openPreview({
    machineId: input.threadRef.machineId,
    input: {
      threadId: input.threadRef.threadId,
      url: input.url,
      viewport: browserDefaultOpenViewport(defaults),
      profileId: browserDefaultOpenProfileId(defaults),
      ...(runtime === undefined ? {} : { runtime }),
    },
  });
  if (result._tag === "Failure") {
    if (isAtomCommandInterrupted(result)) {
      return;
    }
    console.error(
      new TerminalLinkPreviewOpenError({
        ...errorContext,
        cause: result.cause,
      }),
    );
    input.fallbackToBrowser();
    return;
  }
  recordVisitForThread(input.threadRef, input.url);
  applyPreviewServerSnapshot(input.threadRef, result.value);
  useRightPanelStore.getState().openBrowser(input.threadRef, result.value.tabId);
}
