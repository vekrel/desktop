import {
  AuthPreviewOperateScope,
  type PreviewAnnotationPayload,
  type ScopedThreadRef,
} from "@vekrel/contracts";

import type { ComposerImageAttachment } from "~/composerDraftStore";
import { usePreviewAvailable } from "~/browser/previewRuntime";
import { useMachineScope } from "~/state/session";

import { PreviewPanelShell, type PreviewPanelMode } from "./PreviewPanelShell";
import { PreviewView } from "./PreviewView";

interface Props {
  mode: PreviewPanelMode;
  threadRef: ScopedThreadRef;
  tabId?: string | null;
  configuredUrls?: ReadonlyArray<string> | undefined;
  visible: boolean;
  onSendAnnotation?: (
    annotation: PreviewAnnotationPayload,
    image: ComposerImageAttachment | null,
  ) => void;
}

export function PreviewPanel({
  mode,
  threadRef,
  tabId,
  configuredUrls,
  visible,
  onSendAnnotation,
}: Props) {
  const available = usePreviewAvailable(threadRef.machineId);
  const canOperatePreview = useMachineScope(threadRef.machineId, AuthPreviewOperateScope);
  if (!canOperatePreview || !available) {
    return (
      <PreviewPanelShell mode={mode}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            {canOperatePreview
              ? "Preview is only available in the Vekrel desktop app."
              : "Pair this client again with preview access to control browser previews."}
          </p>
        </div>
      </PreviewPanelShell>
    );
  }

  return (
    <PreviewPanelShell mode={mode}>
      <PreviewView
        threadRef={threadRef}
        {...(tabId !== undefined ? { tabId } : {})}
        configuredUrls={configuredUrls}
        visible={visible}
        {...(onSendAnnotation ? { onSendAnnotation } : {})}
      />
    </PreviewPanelShell>
  );
}
