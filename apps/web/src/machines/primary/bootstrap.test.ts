import { MachineId, type ExecutionMachineDescriptor } from "@vekrel/contracts";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  readPrimaryMachineTarget,
  resolvePrimaryMachineHttpUrl,
  resolveInitialPrimaryMachineDescriptor,
  resetPrimaryMachineDescriptorForTests,
} from ".";
import { installMachineHttpTest } from "../../../test/machineHttpTest";

const BASE_MACHINE = {
  machineId: MachineId.make("machine-local"),
  label: "Local machine",
  platform: {
    os: "darwin",
    arch: "arm64",
  },
  serverVersion: "0.0.0-test",
  capabilities: {
    repositoryIdentity: true,
  },
} satisfies ExecutionMachineDescriptor;

let disposeHttpTest: (() => Promise<void>) | undefined;

async function installDescriptorApi() {
  const testApi = await installMachineHttpTest({
    descriptor: () => Effect.succeed(BASE_MACHINE),
  });
  disposeHttpTest = testApi.dispose;
  return testApi;
}

function installTestBrowser(url: string) {
  vi.stubGlobal("window", {
    location: new URL(url),
    history: {
      replaceState: vi.fn(),
    },
  });
}

describe("machineBootstrap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    installTestBrowser("http://localhost/");
  });

  afterEach(async () => {
    await disposeHttpTest?.();
    disposeHttpTest = undefined;
    resetPrimaryMachineDescriptorForTests();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reuses an in-flight descriptor bootstrap request", async () => {
    const testApi = await installDescriptorApi();

    await Promise.all([
      resolveInitialPrimaryMachineDescriptor(),
      resolveInitialPrimaryMachineDescriptor(),
    ]);

    expect(testApi.calls.descriptor).toBe(1);
  });

  it("uses https descriptor urls when the primary machine uses wss", async () => {
    vi.stubEnv("VITE_HTTP_URL", "https://remote.example.com");
    vi.stubEnv("VITE_WS_URL", "wss://remote.example.com");
    await installDescriptorApi();

    await expect(resolveInitialPrimaryMachineDescriptor()).resolves.toEqual(BASE_MACHINE);
    expect(resolvePrimaryMachineHttpUrl("/.well-known/vekrel/machine")).toBe(
      "https://remote.example.com/.well-known/vekrel/machine",
    );
  });

  it("keeps an uppercase wss scheme secure when deriving the http url", () => {
    vi.stubEnv("VITE_WS_URL", "WSS://remote.example.com");

    expect(readPrimaryMachineTarget()?.target).toEqual({
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
    });
  });

  it("keeps an uppercase https scheme secure when deriving the websocket url", () => {
    vi.stubEnv("VITE_HTTP_URL", "HTTPS://remote.example.com");

    expect(readPrimaryMachineTarget()?.target).toEqual({
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
    });
  });

  it("uses the vite proxy for desktop-managed loopback descriptor requests during local dev", async () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "http://127.0.0.1:5733");
    vi.stubGlobal("window", {
      location: new URL("http://127.0.0.1:5733/"),
      history: {
        replaceState: vi.fn(),
      },
      desktopBridge: {
        getLocalMachineBootstraps: () => [
          {
            id: "primary",
            label: "Windows",
            httpBaseUrl: "http://127.0.0.1:3773",
            wsBaseUrl: "ws://127.0.0.1:3773",
            bootstrapToken: "desktop-bootstrap-token",
          },
        ],
      },
    });
    await installDescriptorApi();

    await expect(resolveInitialPrimaryMachineDescriptor()).resolves.toEqual(BASE_MACHINE);
    expect(resolvePrimaryMachineHttpUrl("/.well-known/vekrel/machine")).toBe(
      "http://127.0.0.1:5733/.well-known/vekrel/machine",
    );
  });
});
