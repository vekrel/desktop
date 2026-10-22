import { MachineId } from "@vekrel/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Atom, AsyncResult } from "effect/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";

import {
  composerFileNeedsReattach,
  DraftId,
  useComposerDraftStore,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
} from "../composerDraftStore";

const mocks = vi.hoisted(() => ({
  connectionStateAtom: vi.fn(),
  createAssetUrl: vi.fn(),
  createUploadUrl: Symbol("create-upload-url"),
  executeAtomQuery: vi.fn(),
  removeUpload: Symbol("remove-upload"),
  runAtomCommand: vi.fn(),
  readMachineScope: vi.fn(),
  readPreparedConnection: vi.fn(),
}));

vi.mock("@vekrel/client-runtime/state/runtime", () => ({
  executeAtomQuery: mocks.executeAtomQuery,
  runAtomCommand: mocks.runAtomCommand,
  squashAtomCommandFailure: (result: { readonly error: unknown }) => result.error,
}));

vi.mock("../rpc/atomRegistry", async () => {
  const { AtomRegistry } = await import("effect/reactivity");
  return { appAtomRegistry: AtomRegistry.make() };
});

vi.mock("../connection/catalog", () => ({
  machineCatalog: { stateAtom: mocks.connectionStateAtom },
}));

vi.mock("../state/assets", () => ({
  assetMachine: { createUrl: mocks.createAssetUrl },
}));

vi.mock("../state/attachments", () => ({
  attachmentMachine: {
    createUploadUrl: mocks.createUploadUrl,
    remove: mocks.removeUpload,
  },
}));

vi.mock("../state/session", () => ({
  readMachineScope: mocks.readMachineScope,
  readPreparedConnection: mocks.readPreparedConnection,
}));

import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  readAttachmentUpload,
  releaseAttachmentUpload,
  releaseDraftAttachment,
  releaseDraftAttachments,
  releasePersistedAttachmentUpload,
  retryAttachmentUpload,
  startAttachmentUpload,
  useAttachmentUploadStore,
} from "./attachmentUploadQueue";

type ProgressListener = (event: {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
}) => void;

class TestXmlHttpRequest {
  static requests: TestXmlHttpRequest[] = [];

  status = 0;
  timeout = 0;
  method: string | null = null;
  url: string | null = null;
  readonly headers = new Map<string, string>();
  readonly listeners = new Map<string, () => void>();
  progressListener: ProgressListener | null = null;

  readonly upload = {
    addEventListener: (_event: string, listener: ProgressListener) => {
      this.progressListener = listener;
    },
  };

  constructor() {
    TestXmlHttpRequest.requests.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  addEventListener(event: string, listener: () => void): void {
    this.listeners.set(event, listener);
  }

  send(): void {}

  abort(): void {
    this.listeners.get("abort")?.();
  }

  progress(loaded: number, total: number): void {
    this.progressListener?.({ lengthComputable: true, loaded, total });
  }

  complete(status = 204): void {
    this.status = status;
    this.listeners.get("load")?.();
  }
}

const firstMachine = MachineId.make("machine-1");
const secondMachine = MachineId.make("machine-2");

function makeImage(id: string): ComposerImageAttachment {
  const file = new File([new Uint8Array([1, 2, 3])], `${id}.png`, { type: "image/png" });
  return {
    type: "image",
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: `blob:${id}`,
    file,
  };
}

function makeFile(id: string): ComposerFileAttachment {
  const file = new File([new Uint8Array([1, 2, 3])], `${id}.pdf`, {
    type: "application/pdf",
  });
  return {
    type: "file",
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    file,
  };
}

const connectionStates = Atom.family((_machineId: MachineId) =>
  Atom.make(AsyncResult.success({ phase: "connected" })),
);

function setConnected(machineId: MachineId, connected: boolean) {
  appAtomRegistry.set(
    connectionStates(machineId),
    AsyncResult.success({ phase: connected ? "connected" : "backoff" }),
  );
}

describe("attachmentUploadQueue", () => {
  beforeEach(() => {
    mocks.connectionStateAtom.mockImplementation(connectionStates);
    setConnected(firstMachine, true);
    setConnected(secondMachine, true);
    TestXmlHttpRequest.requests = [];
    mocks.createAssetUrl.mockReset();
    mocks.createAssetUrl.mockImplementation((target: unknown) => target);
    mocks.executeAtomQuery.mockReset();
    mocks.executeAtomQuery.mockResolvedValue({ _tag: "Success", value: {} });
    mocks.runAtomCommand.mockReset();
    mocks.readMachineScope.mockReset().mockReturnValue(true);
    mocks.readPreparedConnection.mockReset();
    mocks.readPreparedConnection.mockReturnValue({ httpBaseUrl: "https://machine.test/" });
    mocks.runAtomCommand.mockImplementation(
      async (
        _registry: unknown,
        command: unknown,
        target: {
          readonly machineId: MachineId;
          readonly input: { readonly name?: string };
        },
      ) => {
        if (command === mocks.createUploadUrl) {
          const attachmentId = `pending-${target.machineId}-${target.input.name}`;
          return {
            _tag: "Success",
            value: {
              attachmentId,
              relativeUrl: `/api/attachments/upload/${attachmentId}`,
              expiresAt: 1,
            },
          };
        }
        return { _tag: "Success", value: undefined };
      },
    );
    vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  });

  afterEach(() => {
    for (const imageId of Object.keys(useAttachmentUploadStore.getState().uploadsByImageId)) {
      releaseAttachmentUpload(imageId);
    }
    vi.unstubAllGlobals();
  });

  it("keeps an attachment local until its own machine grants write access", async () => {
    const image = makeImage("permission-gain");
    mocks.readMachineScope.mockImplementation(
      (machineId) => machineId === firstMachine,
    );

    startAttachmentUpload({ machineId: secondMachine, image });
    expect(mocks.runAtomCommand).not.toHaveBeenCalled();
    expect(TestXmlHttpRequest.requests).toHaveLength(0);
    expect(readAttachmentUpload(image.id)).toBeUndefined();
    expect(image.file).not.toBeNull();

    mocks.readMachineScope.mockReturnValue(true);
    startAttachmentUpload({ machineId: secondMachine, image });
    await Promise.resolve();
    const settled = awaitAttachmentUploads([image.id]);
    TestXmlHttpRequest.requests[0]!.complete();
    await settled;

    expect(readAttachmentUpload(image.id)).toMatchObject({
      status: "ready",
      machineId: secondMachine,
    });
  });

  it("does not transfer bytes or retry when access is revoked while minting an upload", async () => {
    const image = makeImage("revoke-before-bytes");
    let finishMint: (() => void) | undefined;
    mocks.runAtomCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishMint = () =>
            resolve({
              _tag: "Success",
              value: {
                attachmentId: "pending-revoked",
                relativeUrl: "/api/attachments/upload/pending-revoked",
                expiresAt: 1,
              },
            });
        }),
    );
    startAttachmentUpload({ machineId: firstMachine, image });
    const settled = awaitAttachmentUploads([image.id]);
    mocks.readMachineScope.mockReturnValue(false);
    finishMint!();
    await settled;

    expect(TestXmlHttpRequest.requests).toHaveLength(0);
    expect(readAttachmentUpload(image.id)).toMatchObject({
      status: "failed",
      reason: "This connection cannot upload attachments.",
      attachmentId: "pending-revoked",
    });
    retryAttachmentUpload({ machineId: firstMachine, image });
    expect(readAttachmentUpload(image.id)?.status).toBe("failed");
    releaseAttachmentUpload(image.id);
    expect(readAttachmentUpload(image.id)).toBeUndefined();
    expect(mocks.runAtomCommand).toHaveBeenCalledTimes(1);
  });

  it("does not delete a persisted upload using another machine's grant", () => {
    mocks.readMachineScope.mockImplementation(
      (machineId) => machineId === firstMachine,
    );
    releasePersistedAttachmentUpload({
      id: "local-file",
      machineId: secondMachine,
      attachmentId: "persisted-file",
    });
    expect(mocks.runAtomCommand).not.toHaveBeenCalled();

    mocks.readMachineScope.mockReturnValue(true);
    releasePersistedAttachmentUpload({
      id: "local-file",
      machineId: secondMachine,
      attachmentId: "persisted-file",
    });
    expect(mocks.runAtomCommand).toHaveBeenCalledWith(
      expect.anything(),
      mocks.removeUpload,
      { machineId: secondMachine, input: { attachmentId: "persisted-file" } },
      expect.anything(),
    );
  });

  it("uploads images immediately and sends attachment references", async () => {
    const image = {
      ...makeImage("image-1"),
      source: {
        kind: "snap-shot" as const,
        capturedAt: "2026-08-24T11:00:00.000Z",
        appName: "Terminal",
        windowTitle: "Tests",
      },
    };
    startAttachmentUpload({ machineId: firstMachine, image });
    await Promise.resolve();

    const request = TestXmlHttpRequest.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      "https://machine.test/api/attachments/upload/pending-machine-1-image-1.png",
    );
    request.progress(1, 3);
    expect(readAttachmentUpload(image.id)).toMatchObject({ status: "uploading", progress: 1 / 3 });

    const settled = awaitAttachmentUploads([image.id]);
    request.complete();
    await settled;

    expect(getUploadedAttachments({ machineId: firstMachine, images: [image] })).toEqual([
      {
        type: "image",
        id: "pending-machine-1-image-1.png",
        name: "image-1.png",
        mimeType: "image/png",
        sizeBytes: 3,
        source: {
          kind: "snap-shot",
          capturedAt: "2026-08-24T11:00:00.000Z",
          appName: "Terminal",
          windowTitle: "Tests",
        },
      },
    ]);

    releaseDraftAttachments([image]);
    expect(readAttachmentUpload(image.id)).toBeUndefined();
    expect(mocks.runAtomCommand).toHaveBeenCalledWith(
      expect.anything(),
      mocks.removeUpload,
      {
        machineId: firstMachine,
        input: { attachmentId: "pending-machine-1-image-1.png" },
      },
      expect.anything(),
    );
  });

  it("persists a background completion's ids to the draft with no composer mounted", async () => {
    const draftId = DraftId.make("draft-background-upload");
    const file = makeFile("background");
    const draftStore = useComposerDraftStore.getState();
    draftStore.addFiles(draftId, [file]);
    try {
      startAttachmentUpload({
        machineId: firstMachine,
        image: file,
        draftTarget: draftId,
      });
      await Promise.resolve();

      const settled = awaitAttachmentUploads([file.id]);
      TestXmlHttpRequest.requests[0]!.complete();
      await settled;

      expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.files).toMatchObject([
        {
          id: file.id,
          uploadedAttachmentId: "pending-machine-1-background.pdf",
          uploadMachineId: firstMachine,
        },
      ]);
    } finally {
      useComposerDraftStore.getState().clearComposerContent(draftId);
    }
  });

  it("turns an expired persisted file into a marker that a re-pick can replace", async () => {
    const draftId = DraftId.make("draft-expired-upload");
    const file: ComposerFileAttachment = {
      ...makeFile("expired"),
      file: null,
      uploadedAttachmentId: "pending-expired-pdf",
      uploadMachineId: firstMachine,
    };
    mocks.executeAtomQuery.mockResolvedValueOnce({
      _tag: "Failure",
      error: { _tag: "AssetAttachmentNotFoundError" },
    });
    useComposerDraftStore.getState().addFiles(draftId, [file]);

    try {
      startAttachmentUpload({
        machineId: firstMachine,
        image: file,
        draftTarget: draftId,
      });
      await awaitAttachmentUploads([file.id]);

      const marker = useComposerDraftStore.getState().getComposerDraft(draftId)?.files[0];
      expect(readAttachmentUpload(file.id)).toBeUndefined();
      expect(marker?.uploadedAttachmentId).toBeUndefined();
      expect(marker?.uploadMachineId).toBeUndefined();
      expect(marker && composerFileNeedsReattach(marker)).toBe(true);

      const replacementBytes = new File([new Uint8Array([1, 2, 3])], file.name, {
        type: file.mimeType,
      });
      const replacement: ComposerFileAttachment = {
        type: "file",
        id: "expired-repicked",
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        file: replacementBytes,
      };
      useComposerDraftStore.getState().addFiles(draftId, [replacement]);
      expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.files).toMatchObject([
        { id: replacement.id, file: replacementBytes },
      ]);

      startAttachmentUpload({
        machineId: firstMachine,
        image: replacement,
        draftTarget: draftId,
      });
      await Promise.resolve();
      const settled = awaitAttachmentUploads([replacement.id]);
      TestXmlHttpRequest.requests[0]!.complete();
      await settled;

      expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.files).toMatchObject([
        {
          id: replacement.id,
          uploadedAttachmentId: "pending-machine-1-expired.pdf",
          uploadMachineId: firstMachine,
        },
      ]);
      const removeCalls = mocks.runAtomCommand.mock.calls.filter(
        ([, command]) => command === mocks.removeUpload,
      );
      expect(removeCalls).toEqual([]);
    } finally {
      useComposerDraftStore.getState().clearComposerContent(draftId);
    }
  });

  it("removes a persisted upload when its draft is discarded during verification", async () => {
    const file: ComposerFileAttachment = {
      ...makeFile("checking"),
      file: null,
      uploadedAttachmentId: "pending-checking-pdf",
      uploadMachineId: firstMachine,
    };
    let resolveVerification: (result: {
      readonly _tag: "Success";
      readonly value: object;
    }) => void = () => {};
    mocks.executeAtomQuery.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveVerification = resolve;
      }),
    );

    startAttachmentUpload({ machineId: firstMachine, image: file });
    releaseDraftAttachment(file);
    resolveVerification({ _tag: "Success", value: {} });

    expect(mocks.runAtomCommand).toHaveBeenCalledWith(
      expect.anything(),
      mocks.removeUpload,
      {
        machineId: firstMachine,
        input: { attachmentId: "pending-checking-pdf" },
      },
      expect.anything(),
    );
  });

  it("keeps the persisted upload when retrying after a transient verification failure", async () => {
    const draftId = DraftId.make("draft-transient-verification");
    const file: ComposerFileAttachment = {
      ...makeFile("flaky"),
      file: null,
      uploadedAttachmentId: "pending-flaky-pdf",
      uploadMachineId: firstMachine,
    };
    mocks.executeAtomQuery.mockResolvedValueOnce({
      _tag: "Failure",
      error: new Error("socket closed"),
    });
    useComposerDraftStore.getState().addFiles(draftId, [file]);

    try {
      startAttachmentUpload({
        machineId: firstMachine,
        image: file,
        draftTarget: draftId,
      });
      await awaitAttachmentUploads([file.id]);
      expect(readAttachmentUpload(file.id)).toMatchObject({
        status: "failed",
        reason: "Uploaded file could not be verified. Retry when the server reconnects.",
      });
      expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.files).toMatchObject([
        {
          uploadedAttachmentId: "pending-flaky-pdf",
          uploadMachineId: firstMachine,
        },
      ]);

      retryAttachmentUpload({
        machineId: firstMachine,
        image: file,
        draftTarget: draftId,
      });
      await awaitAttachmentUploads([file.id]);

      expect(readAttachmentUpload(file.id)).toEqual({
        status: "ready",
        machineId: firstMachine,
        attachmentId: "pending-flaky-pdf",
      });
      expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.files).toMatchObject([
        {
          uploadedAttachmentId: "pending-flaky-pdf",
          uploadMachineId: firstMachine,
        },
      ]);
      const removeCalls = mocks.runAtomCommand.mock.calls.filter(
        ([, command]) => command === mocks.removeUpload,
      );
      expect(removeCalls).toEqual([]);
    } finally {
      useComposerDraftStore.getState().clearComposerContent(draftId);
    }
  });

  it("routes a live persisted upload through the queue release exactly once", async () => {
    const file: ComposerFileAttachment = {
      ...makeFile("live"),
      file: null,
      uploadedAttachmentId: "pending-live-pdf",
      uploadMachineId: firstMachine,
    };
    startAttachmentUpload({ machineId: firstMachine, image: file });
    await awaitAttachmentUploads([file.id]);
    expect(readAttachmentUpload(file.id)).toMatchObject({ status: "ready" });

    releaseDraftAttachment(file);

    expect(readAttachmentUpload(file.id)).toBeUndefined();
    const removeCalls = mocks.runAtomCommand.mock.calls.filter(
      ([, command]) => command === mocks.removeUpload,
    );
    expect(removeCalls).toEqual([
      [
        expect.anything(),
        mocks.removeUpload,
        {
          machineId: firstMachine,
          input: { attachmentId: "pending-live-pdf" },
        },
        expect.anything(),
      ],
    ]);
  });

  it("releases an upload URL that resolves after its image was removed", async () => {
    const image = makeImage("image-cancelled");
    const minted = {
      _tag: "Success" as const,
      value: {
        attachmentId: "pending-machine-1-image-cancelled.png",
        relativeUrl: "/api/attachments/upload/cancelled",
        expiresAt: 1,
      },
    };
    let resolveMint: (result: typeof minted) => void = () => {};
    const pendingMint = new Promise<typeof minted>((resolve) => {
      resolveMint = resolve;
    });
    let resolveDelete: () => void = () => {};
    const deleted = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    mocks.runAtomCommand.mockImplementation((_registry: unknown, command: unknown) => {
      if (command === mocks.createUploadUrl) {
        return pendingMint;
      }
      resolveDelete();
      return Promise.resolve({ _tag: "Success", value: undefined });
    });

    startAttachmentUpload({ machineId: firstMachine, image });
    releaseAttachmentUpload(image.id);
    resolveMint(minted);
    await deleted;

    expect(TestXmlHttpRequest.requests).toEqual([]);
    expect(readAttachmentUpload(image.id)).toBeUndefined();
    expect(mocks.runAtomCommand).toHaveBeenCalledWith(
      expect.anything(),
      mocks.removeUpload,
      {
        machineId: firstMachine,
        input: { attachmentId: minted.value.attachmentId },
      },
      expect.anything(),
    );
  });

  it("restores the previous machine after a replacement upload fails", async () => {
    const image = makeImage("image-move");
    startAttachmentUpload({ machineId: firstMachine, image });
    await Promise.resolve();
    let settled = awaitAttachmentUploads([image.id]);
    TestXmlHttpRequest.requests[0]!.complete();
    await settled;

    startAttachmentUpload({ machineId: secondMachine, image });
    await Promise.resolve();
    settled = awaitAttachmentUploads([image.id]);
    TestXmlHttpRequest.requests[1]!.complete(500);
    await settled;

    startAttachmentUpload({ machineId: firstMachine, image });
    expect(readAttachmentUpload(image.id)).toMatchObject({
      status: "ready",
      machineId: firstMachine,
      attachmentId: "pending-machine-1-image-move.png",
    });
  });

  it("does not let stalled uploads block another machine", async () => {
    const images = ["image-a", "image-b", "image-c", "image-d"].map(makeImage);
    for (const image of images) {
      startAttachmentUpload({ machineId: firstMachine, image });
    }
    const otherMachineImage = makeImage("image-other");
    startAttachmentUpload({ machineId: secondMachine, image: otherMachineImage });
    await Promise.resolve();

    expect(TestXmlHttpRequest.requests).toHaveLength(4);
    const otherRequest = TestXmlHttpRequest.requests.find((request) =>
      request.url?.includes("machine-2"),
    );
    expect(otherRequest).toBeDefined();

    for (const request of TestXmlHttpRequest.requests) {
      request.complete();
    }
    await Promise.all([
      ...images.slice(0, 3).map((image) => awaitAttachmentUploads([image.id])),
      awaitAttachmentUploads([otherMachineImage.id]),
    ]);
    await Promise.resolve();
    TestXmlHttpRequest.requests[4]!.complete();
    await awaitAttachmentUploads([images[3]!.id]);
  });
});
