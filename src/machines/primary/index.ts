export {
  resetPrimaryMachineDescriptorForTests,
  resolveInitialPrimaryMachineDescriptor,
} from "./context";

export {
  createServerPairingCredential,
  peekPairingTokenFromUrl,
  PrimaryMachinePairingCredentialRejectedError,
  PrimaryMachineRequestError,
  resolveInitialServerAuthGateState,
  revokeOtherServerClientSessions,
  revokeServerClientSession,
  revokeServerPairingLink,
  stripPairingTokenFromUrl,
  submitServerAuthCredential,
  takePairingTokenFromUrl,
  type ServerClientSessionRecord,
  type ServerPairingLinkRecord,
  __resetServerAuthBootstrapForTests,
} from "./auth";

export { usePrimarySessionState } from "./sessionState";

export {
  DesktopMachineBootstrapIncompleteError,
  PrimaryMachineProtocolUnsupportedError,
  PrimaryMachineUrlInvalidError,
  readPrimaryMachineTarget,
  resolvePrimaryMachineHttpUrl,
  isLoopbackHostname,
  type PrimaryMachineTarget,
} from "./target";
