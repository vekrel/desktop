export function isLocalMachineDisabled(): boolean {
  return window.desktopBridge?.getLocalMachineEnabled?.() === false;
}
