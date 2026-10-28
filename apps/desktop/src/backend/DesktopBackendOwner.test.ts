import { ORCHESTRATION_PROTOCOL_VERSION } from "@vekrel/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as DesktopBackendOwner from "./DesktopBackendOwner.ts";

const liveState = Option.some({
  pid: process.pid,
  origin: "http://127.0.0.1:64675",
  serverVersion: "0.1.2",
});
const descriptor = (serverVersion: string, protocol = ORCHESTRATION_PROTOCOL_VERSION) =>
  Option.some({ serverVersion, orchestrationProtocolVersion: protocol });

describe("DesktopBackendOwner.decideOwner", () => {
  const decide = (input: Partial<Parameters<typeof DesktopBackendOwner.decideOwner>[0]>) =>
    DesktopBackendOwner.decideOwner({
      state: liveState,
      pidAlive: true,
      descriptor: descriptor("0.1.2"),
      expectedServerVersion: "0.1.2",
      ...input,
    })._tag;

  it("attaches to a live owner on the same release and protocol", () => {
    const verdict = DesktopBackendOwner.decideOwner({
      state: liveState,
      pidAlive: true,
      descriptor: descriptor("0.1.2"),
      expectedServerVersion: "0.1.2",
    });
    assert.deepEqual(verdict, {
      _tag: "Attach",
      httpBaseUrl: new URL("http://127.0.0.1:64675"),
    });
  });

  it("refuses a missing, dead, unreachable, or incompatible owner", () => {
    assert.equal(decide({ state: Option.none() }), "Refuse");
    assert.equal(decide({ pidAlive: false }), "Refuse");
    assert.equal(decide({ descriptor: Option.none() }), "Refuse");
    assert.equal(decide({ descriptor: descriptor("0.1.1") }), "Refuse");
    assert.equal(
      decide({ descriptor: descriptor("0.1.2", ORCHESTRATION_PROTOCOL_VERSION - 1) }),
      "Refuse",
    );
  });
});

describe("DesktopBackendOwner.findCompatibleOwner", () => {
  const run = (input: { readonly stateJson?: string; readonly status?: number }) =>
    DesktopBackendOwner.findCompatibleOwner("/home/.vekrel/userdata", "0.1.2").pipe(
      Effect.provide(
        Layer.mergeAll(
          FileSystem.layerNoop({
            readFileString: () =>
              input.stateJson === undefined
                ? Effect.fail(
                    PlatformError.systemError({
                      _tag: "NotFound",
                      module: "FileSystem",
                      method: "readFileString",
                    }),
                  )
                : Effect.succeed(input.stateJson),
          }),
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response(
                    JSON.stringify({
                      machineId: "machine-1",
                      label: "Mac",
                      platform: { os: "darwin", arch: "arm64" },
                      serverVersion: "0.1.2",
                      orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
                      capabilities: { repositoryIdentity: true },
                    }),
                    { status: input.status ?? 200 },
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );

  const stateJson = JSON.stringify({
    version: 1,
    pid: process.pid,
    port: 64675,
    origin: "http://127.0.0.1:64675",
    startedAt: "2026-10-28T00:00:00.000Z",
    serviceManaged: true,
    serverVersion: "0.1.2",
  });

  it.effect("finds the owner's URL from its runtime state", () =>
    Effect.gen(function* () {
      const owner = yield* run({ stateJson });
      assert.deepEqual(owner, Option.some(new URL("http://127.0.0.1:64675")));
    }),
  );

  it.effect("returns none without runtime state or when the owner does not answer", () =>
    Effect.gen(function* () {
      assert.isTrue(Option.isNone(yield* run({})));
      assert.isTrue(Option.isNone(yield* run({ stateJson, status: 502 })));
    }),
  );
});
