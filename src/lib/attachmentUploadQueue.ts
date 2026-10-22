import {
  AuthOrchestrationOperateScope,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  type ChatAttachment,
  type MachineId,
} from "@vekrel/contracts";
import { parseScopedThreadKey } from "@vekrel/client-runtime/machine";
import { resolveAssetUrl } from "@vekrel/client-runtime/state/assets";
import {
  deletePendingAttachmentUpload,
  runAttachmentUploadCycle,
  verifyPersistedAttachmentUpload,
  type PersistedAttachmentVerification,
} from "@vekrel/client-runtime/state/attachments";
import { create } from "zustand";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import {
  DraftId,
  useComposerDraftStore,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type ComposerThreadTarget,
} from "../composerDraftStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { machineCatalog } from "../connection/catalog";
import { assetMachine } from "../state/assets";
import { attachmentMachine } from "../state/attachments";
import { readMachineScope, readPreparedConnection } from "../state/session";
import type { AttachmentUploadState, ReadyAttachmentUpload } from "./attachmentUploadState";

const MAX_UPLOADS_PER_MACHINE = 3;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

interface AttachmentUploadStore {
  readonly uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>;
}

export const useAttachmentUploadStore = create<AttachmentUploadStore>(() => ({
  uploadsByImageId: {},
}));

interface UploadJob {
  readonly image: ComposerImageAttachment | ComposerFileAttachment;
  readonly machineId: MachineId;
  /**
   * The draft that owned this file when the job started. Completion resolves
   * the current owner because the file can move while the upload is pending.
   */
  readonly draftTarget?: ComposerThreadTarget;
  readonly previous?: ReadyAttachmentUpload;
  /**
   * The draft owns this id; the queue never deletes it on cancel or retry.
   * Deleting it goes through `releasePersistedAttachmentUpload` only.
   */
  readonly persistedAttachmentId?: string;
  readonly settled: Promise<void>;
  resolveSettled: () => void;
  attachmentId: string | null;
  cancelled: boolean;
  abort: (() => void) | null;
  stopWatchingConnection: () => void;
}

const jobsByImageId = new Map<string, UploadJob>();
const queue: UploadJob[] = [];
const activeUploadsByMachine = new Map<MachineId, number>();

function setUploadState(imageId: string, upload: AttachmentUploadState): void {
  useAttachmentUploadStore.setState((state) => ({
    uploadsByImageId: { ...state.uploadsByImageId, [imageId]: upload },
  }));
}

function clearUploadState(imageId: string): void {
  useAttachmentUploadStore.setState((state) => {
    if (!(imageId in state.uploadsByImageId)) {
      return state;
    }
    const uploadsByImageId = { ...state.uploadsByImageId };
    delete uploadsByImageId[imageId];
    return { uploadsByImageId };
  });
}

export function readAttachmentUpload(imageId: string): AttachmentUploadState | undefined {
  return useAttachmentUploadStore.getState().uploadsByImageId[imageId];
}

function resolveCurrentFileDraftTarget(job: UploadJob): ComposerThreadTarget | undefined {
  if (job.draftTarget === undefined || job.image.type !== "file") {
    return undefined;
  }
  const store = useComposerDraftStore.getState();
  for (const [key, draft] of Object.entries(store.draftsByThreadKey)) {
    if (!draft.files.some((file) => file.id === job.image.id)) {
      continue;
    }
    const draftSession = store.draftThreadsByThreadKey[key];
    if (draftSession !== undefined) {
      if (draftSession.machineId === job.machineId) {
        return DraftId.make(key);
      }
      continue;
    }
    if (typeof job.draftTarget === "string" && job.draftTarget === key) {
      return DraftId.make(key);
    }
    const threadRef = parseScopedThreadKey(key);
    if (threadRef?.machineId === job.machineId) {
      return threadRef;
    }
  }
  return undefined;
}

/**
 * The mounted composer effect performs the same write for live UI updates, but
 * a background completion (user navigated away, upload finished, reload) must
 * not depend on a mounted composer to survive.
 */
function stampDraftFileUpload(job: UploadJob, attachmentId: string): void {
  const draftTarget = resolveCurrentFileDraftTarget(job);
  if (draftTarget === undefined) {
    return;
  }
  useComposerDraftStore
    .getState()
    .setFileUpload(draftTarget, job.image.id, job.machineId, attachmentId);
}

function deletePendingUpload(machineId: MachineId, attachmentId: string): void {
  if (!readMachineScope(machineId, AuthOrchestrationOperateScope)) return;
  deletePendingAttachmentUpload({
    registry: appAtomRegistry,
    remove: attachmentMachine.remove,
    machineId,
    attachmentId,
  });
}

function uploadBytes(input: {
  readonly url: string;
  readonly file: File;
  readonly mimeType: string;
  readonly onProgress: (progress: number) => void;
}): { readonly done: Promise<void>; readonly abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<void>((resolve, reject) => {
    xhr.open("POST", input.url, true);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader("Content-Type", input.mimeType);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        input.onProgress(event.loaded / event.total);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload rejected (${xhr.status})`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.addEventListener("timeout", () => reject(new Error("Upload timed out")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    xhr.send(input.file);
  });

  return { done, abort: () => xhr.abort() };
}

async function runUpload(job: UploadJob): Promise<void> {
  if (!readMachineScope(job.machineId, AuthOrchestrationOperateScope)) {
    setUploadState(job.image.id, {
      status: "failed",
      machineId: job.machineId,
      reason: "This connection cannot upload attachments.",
      ...(job.previous ? { previous: job.previous } : {}),
    });
    return;
  }
  if (job.persistedAttachmentId) {
    const verification = await verifyPersistedAttachmentUpload({
      registry: appAtomRegistry,
      createAssetUrl: assetMachine.createUrl,
      machineId: job.machineId,
      attachmentId: job.persistedAttachmentId,
    });
    if (job.cancelled) {
      return;
    }
    if (verification.status === "verified") {
      setUploadState(job.image.id, {
        status: "ready",
        machineId: job.machineId,
        attachmentId: job.persistedAttachmentId,
      });
      stampDraftFileUpload(job, job.persistedAttachmentId);
      return;
    }
    if (verification.status === "missing" && !job.image.file && job.image.type === "file") {
      const draftTarget = resolveCurrentFileDraftTarget(job);
      if (
        draftTarget !== undefined &&
        useComposerDraftStore
          .getState()
          .markFileUploadMissing(
            draftTarget,
            job.image.id,
            job.machineId,
            job.persistedAttachmentId,
          )
      ) {
        clearUploadState(job.image.id);
        return;
      }
    }
    if (verification.status === "failed" || !job.image.file) {
      // No `attachmentId` here: a failed state's id marks a pending upload
      // this queue minted, which retry and release then delete. The persisted
      // id is the only server copy of a hydrated file, so a transient
      // verification failure must leave it in place for the next retry.
      setUploadState(job.image.id, {
        status: "failed",
        machineId: job.machineId,
        reason:
          verification.status === "missing"
            ? "Uploaded file expired. Remove it and attach it again."
            : "Uploaded file could not be verified. Retry when the server reconnects.",
        ...(job.previous ? { previous: job.previous } : {}),
      });
      return;
    }
  }

  const mimeType =
    job.image.type === "file"
      ? job.image.mimeType.toLowerCase()
      : PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES.find(
          (supportedMimeType) => supportedMimeType === job.image.mimeType.toLowerCase(),
        );
  if (!mimeType) {
    setUploadState(job.image.id, {
      status: "failed",
      machineId: job.machineId,
      reason: "Unsupported image type",
      ...(job.previous ? { previous: job.previous } : {}),
    });
    return;
  }
  const file = job.image.file;
  if (!file) {
    setUploadState(job.image.id, {
      status: "failed",
      machineId: job.machineId,
      reason: "Original file is no longer available",
      ...(job.previous ? { previous: job.previous } : {}),
    });
    return;
  }

  let lastStep = -1;
  if (!readMachineScope(job.machineId, AuthOrchestrationOperateScope)) {
    setUploadState(job.image.id, {
      status: "failed",
      machineId: job.machineId,
      reason: "This connection cannot upload attachments.",
      ...(job.previous ? { previous: job.previous } : {}),
    });
    return;
  }
  const result = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentMachine.createUploadUrl,
    remove: attachmentMachine.remove,
    machineId: job.machineId,
    upload: {
      ...(job.image.type === "file" ? { type: "file" as const } : {}),
      name: job.image.name,
      mimeType,
      sizeBytes: file.size,
    },
    resolveUploadUrl: (relativeUrl) => {
      if (
        job.cancelled ||
        !readMachineScope(job.machineId, AuthOrchestrationOperateScope)
      ) {
        return null;
      }
      const connection = readPreparedConnection(job.machineId);
      return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
    },
    transport: (url) =>
      uploadBytes({
        url,
        file,
        mimeType,
        onProgress: (progress) => {
          const step = Math.floor(progress * 20);
          if (step === lastStep || job.cancelled) {
            return;
          }
          lastStep = step;
          setUploadState(job.image.id, {
            status: "uploading",
            machineId: job.machineId,
            progress,
            ...(job.previous ? { previous: job.previous } : {}),
          });
        },
      }),
    onMinted: (attachmentId) => {
      if (job.cancelled && readMachineScope(job.machineId, AuthOrchestrationOperateScope)) {
        return "cancel";
      }
      job.attachmentId = attachmentId;
      return "continue";
    },
    onTransferStart: (abort) => {
      job.abort = abort;
    },
  });
  job.abort = null;
  if (result.status === "cancelled" || job.cancelled) {
    return;
  }
  if (result.status === "uploaded") {
    setUploadState(job.image.id, {
      status: "ready",
      machineId: job.machineId,
      attachmentId: result.attachmentId,
    });
    stampDraftFileUpload(job, result.attachmentId);
    if (job.previous) {
      deletePendingUpload(job.previous.machineId, job.previous.attachmentId);
    }
    return;
  }
  setUploadState(job.image.id, {
    status: "failed",
    machineId: job.machineId,
    reason:
      result.step === "mint"
        ? "Upload could not start"
        : result.step === "resolve-url"
          ? readMachineScope(job.machineId, AuthOrchestrationOperateScope)
            ? "Not connected"
            : "This connection cannot upload attachments."
          : result.error instanceof Error
            ? result.error.message
            : "Upload failed",
    ...(result.attachmentId ? { attachmentId: result.attachmentId } : {}),
    ...(job.previous ? { previous: job.previous } : {}),
  });
}

function pumpUploads(): void {
  for (let index = 0; index < queue.length;) {
    const job = queue[index]!;
    const active = activeUploadsByMachine.get(job.machineId) ?? 0;
    if (active >= MAX_UPLOADS_PER_MACHINE) {
      index += 1;
      continue;
    }

    queue.splice(index, 1);
    if (job.cancelled) {
      continue;
    }
    activeUploadsByMachine.set(job.machineId, active + 1);
    void runUpload(job)
      .catch(() => {
        if (!job.cancelled) {
          setUploadState(job.image.id, {
            status: "failed",
            machineId: job.machineId,
            reason: "Upload failed",
            ...(job.previous ? { previous: job.previous } : {}),
          });
        }
      })
      .finally(() => {
        if (
          jobsByImageId.get(job.image.id) === job &&
          readAttachmentUpload(job.image.id)?.status !== "failed"
        ) {
          job.stopWatchingConnection();
          jobsByImageId.delete(job.image.id);
        }
        const remaining = (activeUploadsByMachine.get(job.machineId) ?? 1) - 1;
        if (remaining > 0) {
          activeUploadsByMachine.set(job.machineId, remaining);
        } else {
          activeUploadsByMachine.delete(job.machineId);
        }
        job.resolveSettled();
        pumpUploads();
      });
  }
}

export function startAttachmentUpload(input: {
  readonly machineId: MachineId;
  readonly image: ComposerImageAttachment | ComposerFileAttachment;
  readonly draftTarget?: ComposerThreadTarget;
}): void {
  if (!readMachineScope(input.machineId, AuthOrchestrationOperateScope)) return;
  const existingJob = jobsByImageId.get(input.image.id);
  if (existingJob?.machineId === input.machineId) {
    return;
  }

  const existing = readAttachmentUpload(input.image.id);
  if (existing?.status === "ready" && existing.machineId === input.machineId) {
    return;
  }
  if (existing?.status === "failed" && existing.machineId === input.machineId) {
    return;
  }
  if (
    existing &&
    "previous" in existing &&
    existing.previous?.machineId === input.machineId
  ) {
    cancelAttachmentUpload(input.image.id);
    if (existing.status === "failed" && existing.attachmentId) {
      deletePendingUpload(existing.machineId, existing.attachmentId);
    }
    setUploadState(input.image.id, existing.previous);
    return;
  }

  if (existingJob) {
    cancelAttachmentUpload(input.image.id);
  }
  const previous = existing?.status === "ready" ? existing : existing?.previous;
  let resolveSettled: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  const job: UploadJob = {
    image: input.image,
    machineId: input.machineId,
    ...(input.draftTarget !== undefined ? { draftTarget: input.draftTarget } : {}),
    ...(previous ? { previous } : {}),
    ...(input.image.type === "file" &&
    input.image.uploadMachineId === input.machineId &&
    input.image.uploadedAttachmentId
      ? { persistedAttachmentId: input.image.uploadedAttachmentId }
      : {}),
    settled,
    resolveSettled,
    attachmentId: null,
    cancelled: false,
    abort: null,
    stopWatchingConnection: () => {},
  };

  jobsByImageId.set(input.image.id, job);
  const connectionAtom = machineCatalog.stateAtom(job.machineId);
  const isConnected = () =>
    Option.exists(
      AsyncResult.value(appAtomRegistry.get(connectionAtom)),
      (state) => state.phase === "connected",
    );
  let wasConnected = isConnected();
  job.stopWatchingConnection = appAtomRegistry.subscribe(connectionAtom, () => {
    const connected = isConnected();
    const reconnected = connected && !wasConnected;
    wasConnected = connected;
    if (!reconnected) return;
    // The HTTP failure can arrive after the socket has already reconnected.
    // Wait for that attempt, then retry only if this job still owns the file.
    void job.settled.then(() => {
      if (
        jobsByImageId.get(job.image.id) === job &&
        readAttachmentUpload(job.image.id)?.status === "failed" &&
        isConnected()
      ) {
        retryAttachmentUpload(input);
      }
    });
  });
  queue.push(job);
  setUploadState(input.image.id, {
    status: "uploading",
    machineId: input.machineId,
    progress: 0,
    ...(previous ? { previous } : {}),
  });
  pumpUploads();
}

function cancelAttachmentUpload(imageId: string): void {
  const job = jobsByImageId.get(imageId);
  if (!job) {
    return;
  }
  job.cancelled = true;
  job.stopWatchingConnection();
  jobsByImageId.delete(imageId);
  const queuedIndex = queue.indexOf(job);
  if (queuedIndex !== -1) {
    queue.splice(queuedIndex, 1);
  }
  job.abort?.();
  if (job.attachmentId) {
    deletePendingUpload(job.machineId, job.attachmentId);
  }
  job.resolveSettled();
}

export function releaseAttachmentUpload(imageId: string): void {
  const upload = readAttachmentUpload(imageId);
  cancelAttachmentUpload(imageId);
  if (upload?.status === "ready") {
    deletePendingUpload(upload.machineId, upload.attachmentId);
  } else if (upload) {
    if (upload.status === "failed" && upload.attachmentId) {
      deletePendingUpload(upload.machineId, upload.attachmentId);
    }
    if (upload.previous) {
      deletePendingUpload(upload.previous.machineId, upload.previous.attachmentId);
    }
  }
  clearUploadState(imageId);
}

export function releasePersistedAttachmentUpload(input: {
  readonly id: string;
  readonly machineId: MachineId;
  readonly attachmentId: string;
}): void {
  const upload = readAttachmentUpload(input.id);
  if (
    upload?.status === "ready" &&
    upload.machineId === input.machineId &&
    upload.attachmentId === input.attachmentId
  ) {
    releaseAttachmentUpload(input.id);
    return;
  }
  const job = jobsByImageId.get(input.id);
  if (
    job?.machineId === input.machineId &&
    job.persistedAttachmentId === input.attachmentId
  ) {
    releaseAttachmentUpload(input.id);
  }
  deletePendingUpload(input.machineId, input.attachmentId);
}

export function retryAttachmentUpload(input: {
  readonly machineId: MachineId;
  readonly image: ComposerImageAttachment | ComposerFileAttachment;
  readonly draftTarget?: ComposerThreadTarget;
}): void {
  if (!readMachineScope(input.machineId, AuthOrchestrationOperateScope)) return;
  const previous = readAttachmentUpload(input.image.id);
  cancelAttachmentUpload(input.image.id);
  if (previous?.status === "failed" && previous.attachmentId) {
    deletePendingUpload(previous.machineId, previous.attachmentId);
  }
  if (previous && "previous" in previous && previous.previous) {
    setUploadState(input.image.id, previous.previous);
  } else {
    clearUploadState(input.image.id);
  }
  startAttachmentUpload(input);
}

/**
 * Pending uploads are swept after 24 hours, so a stash restore asks first
 * instead of handing the composer a dead reference.
 */
export function verifyStashedAttachmentUpload(input: {
  readonly machineId: MachineId;
  readonly attachmentId: string;
}): Promise<PersistedAttachmentVerification> {
  return verifyPersistedAttachmentUpload({
    registry: appAtomRegistry,
    createAssetUrl: assetMachine.createUrl,
    machineId: input.machineId,
    attachmentId: input.attachmentId,
  });
}

export async function awaitAttachmentUploads(imageIds: ReadonlyArray<string>): Promise<void> {
  await Promise.all(imageIds.map((imageId) => jobsByImageId.get(imageId)?.settled));
}

export function getUploadedAttachments(input: {
  readonly machineId: MachineId;
  readonly images: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>;
}): ChatAttachment[] | null {
  const attachments: ChatAttachment[] = [];
  for (const image of input.images) {
    const upload = readAttachmentUpload(image.id);
    if (upload?.status !== "ready" || upload.machineId !== input.machineId) {
      return null;
    }
    attachments.push({
      type: image.type,
      id: upload.attachmentId,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      ...(image.source ? { source: image.source } : {}),
    });
  }
  return attachments;
}

/**
 * The queue-keyed release only sees in-memory state, so after a reload it finds
 * nothing and the pending upload leaks. Every draft discard path must funnel
 * through here.
 */
export function releaseDraftAttachment(
  attachment: ComposerImageAttachment | ComposerFileAttachment,
): void {
  if (
    attachment.type === "file" &&
    attachment.uploadedAttachmentId !== undefined &&
    attachment.uploadMachineId !== undefined
  ) {
    releasePersistedAttachmentUpload({
      id: attachment.id,
      machineId: attachment.uploadMachineId,
      attachmentId: attachment.uploadedAttachmentId,
    });
    if (jobsByImageId.has(attachment.id) || readAttachmentUpload(attachment.id)) {
      releaseAttachmentUpload(attachment.id);
    }
    return;
  }
  releaseAttachmentUpload(attachment.id);
}

export function releaseDraftAttachments(
  attachments: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>,
): void {
  for (const attachment of attachments) {
    releaseDraftAttachment(attachment);
  }
}
