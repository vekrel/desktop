import type { MachineId } from "@vekrel/contracts";

export type ReadyAttachmentUpload = {
  readonly status: "ready";
  readonly machineId: MachineId;
  readonly attachmentId: string;
};

export type AttachmentUploadState =
  | {
      readonly status: "uploading";
      readonly machineId: MachineId;
      readonly progress: number;
      readonly previous?: ReadyAttachmentUpload;
    }
  | ReadyAttachmentUpload
  | {
      readonly status: "failed";
      readonly machineId: MachineId;
      readonly reason: string;
      /**
       * Retry and release delete it, so it must never carry a draft's persisted
       * attachment id.
       */
      readonly attachmentId?: string;
      readonly previous?: ReadyAttachmentUpload;
    };

export function attachmentUploadBlockReason(input: {
  readonly imageIds: ReadonlyArray<string>;
  readonly uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>;
  readonly machineId: MachineId;
}): string | null {
  let pending = 0;

  for (const imageId of input.imageIds) {
    const upload = input.uploadsByImageId[imageId];
    // Send retries failed uploads, so they must not disable it.
    if (upload?.status === "failed" && upload.machineId === input.machineId) continue;
    if (upload?.status !== "ready" || upload.machineId !== input.machineId) {
      pending += 1;
    }
  }

  if (pending > 0) {
    return pending === 1 ? "Attachment still uploading" : "Attachments still uploading";
  }
  return null;
}

export function formatAttachmentUploadProgress(progress: number): string {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return `${Math.floor(bounded * 100)}%`;
}
