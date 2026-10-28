// Attach the desktop to a Vekrel server that already owns its home (the background
// service or `vekrel serve`) instead of refusing to start.
import { ExecutionMachineDescriptor, ORCHESTRATION_PROTOCOL_VERSION } from "@vekrel/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import serverPackageJson from "../../../server/package.json" with { type: "json" };
import type * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import type { AttachedOwner } from "./DesktopBackendManager.ts";

const OWNER_PROBE_TIMEOUT = Duration.millis(2_500);
const MINT_TIMEOUT = Duration.seconds(30);
const OWNER_POLL_INTERVAL = Duration.seconds(2);
const OWNER_RETURN_POLL_INTERVAL = Duration.seconds(1);
// shortcut: a restarting service frees the home for a few seconds; waiting this
// long keeps the desktop from claiming it. Upgrade if restarts ever take longer.
const OWNER_RETURN_ATTEMPTS = 15;

// The fields of the server's `server-runtime.json` the desktop needs.
const OwnerRuntimeState = Schema.Struct({
  pid: Schema.Int,
  origin: Schema.String,
  serverVersion: Schema.optional(Schema.String),
});
type OwnerRuntimeState = typeof OwnerRuntimeState.Type;
const decodeOwnerRuntimeState = Schema.decodeUnknownOption(
  Schema.fromJsonString(OwnerRuntimeState),
);

const PairingCredentialOutput = Schema.Struct({ credential: Schema.String });
const decodePairingCredentialOutput = Schema.decodeUnknownOption(
  Schema.fromJsonString(PairingCredentialOutput),
);

export type OwnerVerdict =
  | { readonly _tag: "Attach"; readonly httpBaseUrl: URL }
  | { readonly _tag: "Refuse"; readonly reason: string };

/**
 * The desktop mints its credential with its own bundled server code against the
 * owner's database, so only an owner running the same server release (and so the
 * same migrations and protocol) is compatible.
 */
export const decideOwner = (input: {
  readonly state: Option.Option<OwnerRuntimeState>;
  readonly pidAlive: boolean;
  readonly descriptor: Option.Option<
    Pick<ExecutionMachineDescriptor, "serverVersion" | "orchestrationProtocolVersion">
  >;
  readonly expectedServerVersion: string;
}): OwnerVerdict => {
  if (Option.isNone(input.state)) return { _tag: "Refuse", reason: "no runtime state" };
  if (!input.pidAlive) return { _tag: "Refuse", reason: "owner process is gone" };
  if (Option.isNone(input.descriptor)) return { _tag: "Refuse", reason: "owner unreachable" };
  const { serverVersion, orchestrationProtocolVersion } = input.descriptor.value;
  if (serverVersion !== input.expectedServerVersion) {
    return { _tag: "Refuse", reason: `owner runs ${serverVersion}` };
  }
  if (orchestrationProtocolVersion !== ORCHESTRATION_PROTOCOL_VERSION) {
    return { _tag: "Refuse", reason: "owner speaks another orchestration protocol" };
  }
  return { _tag: "Attach", httpBaseUrl: new URL(input.state.value.origin) };
};

// Signal 0 only checks existence; EPERM means it exists under another user.
const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

const probeDescriptor = Effect.fn("desktop.backendOwner.probeDescriptor")(
  function* (origin: string) {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(new URL("/.well-known/vekrel/machine", origin).href);
    return yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ExecutionMachineDescriptor)),
    );
  },
  Effect.timeout(OWNER_PROBE_TIMEOUT),
  Effect.option,
);

export const findCompatibleOwner = Effect.fn("desktop.backendOwner.findCompatibleOwner")(function* (
  stateDir: string,
  expectedServerVersion: string = serverPackageJson.version,
) {
  const fs = yield* FileSystem.FileSystem;
  const state = yield* fs.readFileString(`${stateDir}/server-runtime.json`).pipe(
    Effect.map(decodeOwnerRuntimeState),
    Effect.orElseSucceed(() => Option.none<OwnerRuntimeState>()),
  );
  const pidAlive = Option.isSome(state) && isProcessAlive(state.value.pid);
  const descriptor =
    pidAlive && Option.isSome(state) ? yield* probeDescriptor(state.value.origin) : Option.none();
  const verdict = decideOwner({ state, pidAlive, descriptor, expectedServerVersion });
  if (verdict._tag === "Refuse") {
    yield* Effect.logInfo("not attaching to the Vekrel home owner", { reason: verdict.reason });
    return Option.none<URL>();
  }
  return Option.some(verdict.httpBaseUrl);
});

/**
 * Mint a one-time pairing credential the same way `vekrel auth pairing create`
 * does, by running the bundled server CLI against the owner's home. The desktop
 * exchanges it once for a bearer session, exactly as with its own backend.
 */
const mintPairingCredential = (environment: DesktopEnvironment.DesktopEnvironment["Service"]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const handle = yield* spawner.spawn(
        ChildProcess.make(
          process.execPath,
          [
            environment.backendEntryPath,
            "auth",
            "pairing",
            "create",
            "--base-dir",
            environment.baseDir,
            ...Option.match(environment.devServerUrl, {
              onNone: () => [],
              onSome: (url) => ["--dev-url", url.href],
            }),
            "--label",
            "Vekrel Desktop",
            "--ttl",
            "5m",
            "--json",
          ],
          {
            cwd: environment.backendCwd,
            env: { ELECTRON_RUN_AS_NODE: "1" },
            extendEnv: true,
            stdin: "ignore",
            stderr: "ignore",
          },
        ),
      );
      const [stdout, exitCode] = yield* Effect.all(
        [handle.stdout.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
        { concurrency: "unbounded" },
      );
      if (exitCode !== 0) return Option.none<string>();
      return Option.map(decodePairingCredentialOutput(stdout.trim()), (out) => out.credential);
    }),
  ).pipe(
    Effect.timeout(MINT_TIMEOUT),
    Effect.orElseSucceed(() => Option.none<string>()),
  );

/** Resolves once the owner at `httpBaseUrl` stopped and did not come back on the same URL. */
export const awaitOwnerGone = Effect.fn("desktop.backendOwner.awaitOwnerGone")(function* (
  stateDir: string,
  httpBaseUrl: URL,
) {
  const sameOwner = findCompatibleOwner(stateDir).pipe(
    Effect.map((owner) =>
      Option.isNone(owner) ? "none" : owner.value.href === httpBaseUrl.href ? "same" : "moved",
    ),
  );
  while (true) {
    while ((yield* sameOwner) === "same") yield* Effect.sleep(OWNER_POLL_INTERVAL);
    let next: "none" | "same" | "moved" = "none";
    for (let attempt = 0; attempt < OWNER_RETURN_ATTEMPTS && next === "none"; attempt += 1) {
      yield* Effect.sleep(OWNER_RETURN_POLL_INTERVAL);
      next = yield* sameOwner;
    }
    // "moved" ends this attachment too; the restart path attaches to the new URL.
    if (next !== "same") return;
  }
});

export const attachToOwner = Effect.fn("desktop.backendOwner.attachToOwner")(function* (
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
) {
  const context = yield* Effect.context<FileSystem.FileSystem | HttpClient.HttpClient>();
  const owner = yield* findCompatibleOwner(environment.stateDir);
  if (Option.isNone(owner)) return Option.none<AttachedOwner>();
  const credential = yield* mintPairingCredential(environment);
  if (Option.isNone(credential)) {
    yield* Effect.logWarning("could not mint a pairing credential for the Vekrel home owner");
    return Option.none<AttachedOwner>();
  }
  yield* Effect.logInfo("attaching to the running Vekrel server", { url: owner.value.href });
  return Option.some<AttachedOwner>({
    httpBaseUrl: owner.value,
    bootstrapToken: credential.value,
    awaitGone: awaitOwnerGone(environment.stateDir, owner.value).pipe(Effect.provide(context)),
  });
});
