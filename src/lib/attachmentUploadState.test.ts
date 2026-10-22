import { MachineId } from "@vekrel/contracts";
import { describe, expect, it } from "vite-plus/test";

import { attachmentUploadBlockReason } from "./attachmentUploadState";

const machineId = MachineId.make("machine-1");

describe("attachmentUploadBlockReason", () => {
  it("does not accept an upload from another machine", () => {
    expect(
      attachmentUploadBlockReason({
        imageIds: ["image-1"],
        machineId,
        uploadsByImageId: {
          "image-1": {
            status: "ready",
            machineId: MachineId.make("machine-2"),
            attachmentId: "pending-1",
          },
        },
      }),
    ).toBe("Attachment still uploading");
  });
});
