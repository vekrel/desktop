import { createAttachmentMachineAtoms } from "@vekrel/client-runtime/state/attachments";

import { connectionAtomRuntime } from "../connection/runtime";

export const attachmentMachine = createAttachmentMachineAtoms(connectionAtomRuntime);
