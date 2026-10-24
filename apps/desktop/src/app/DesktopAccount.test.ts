// @effect-diagnostics nodeBuiltinImport:off - The fake relay is a real localhost listener, like the relay the app talks to.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";

import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopAccount from "./DesktopAccount.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

interface FakeRelay {
  readonly url: string;
  readonly requests: Array<Record<string, string>>;
  /** The refresh token the relay accepts next (rotation). */
  current: string | null;
  challenge: string | null;
  /** Under the client's 30 s skew, so every `getAccessToken` refreshes. */
  expiresIn: number;
}

/** /oauth/token and /oauth/revoke as the relay answers them: one code, rotating refresh tokens. */
const fakeRelay = Effect.acquireRelease(
  Effect.promise(async () => {
    let issued = 0;
    const relay: FakeRelay = {
      url: "",
      requests: [],
      current: null,
      challenge: null,
      expiresIn: 600,
    };
    const issue = () => {
      issued += 1;
      relay.current = `refresh-${issued}`;
      return {
        access_token: `access-${issued}`,
        refresh_token: relay.current,
        expires_in: relay.expiresIn,
      };
    };
    const server = NodeHttp.createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => (raw += chunk));
      request.on("end", () => {
        const form = Object.fromEntries(new URLSearchParams(raw));
        relay.requests.push({ path: request.url ?? "", ...form });
        const reply = (status: number, body: unknown) => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(body));
        };
        if (request.url === "/oauth/revoke") {
          if (form.token === relay.current) relay.current = null;
          return reply(200, {});
        }
        const verifierMatches =
          form.code_verifier !== undefined &&
          NodeCrypto.createHash("sha256").update(form.code_verifier).digest("base64url") ===
            relay.challenge;
        if (
          form.grant_type === "authorization_code" &&
          form.code === "code-1" &&
          form.client_id === "vekrel-desktop" &&
          form.redirect_uri === "vekrel-dev://auth/callback" &&
          verifierMatches
        ) {
          return reply(200, issue());
        }
        if (form.grant_type === "refresh_token" && form.refresh_token === relay.current) {
          return reply(200, issue());
        }
        return reply(400, { error: "invalid_grant" });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    return { relay: Object.assign(relay, { url: `http://127.0.0.1:${address.port}` }), server };
  }),
  ({ server }) =>
    Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
).pipe(Effect.map(({ relay }) => relay));

/** Reversible but not plaintext, like safeStorage; `basic_text` marks Linux's fixed-key backend. */
const safeStorageWith = (options: { available: boolean; backend?: string }) =>
  ElectronSafeStorage.ElectronSafeStorage.of({
    isEncryptionAvailable: Effect.succeed(options.available),
    encryptString: (value) =>
      Effect.succeed(new TextEncoder().encode(`enc:${Buffer.from(value).toString("base64")}`)),
    decryptString: (value) =>
      Effect.succeed(
        Buffer.from(new TextDecoder().decode(value).slice(4), "base64").toString("utf8"),
      ),
    selectedStorageBackend: Effect.succeed(Option.fromNullishOr(options.backend)),
  });

const withAccount = <A, E>(
  stateDir: string,
  relay: FakeRelay,
  safeStorage: ElectronSafeStorage.ElectronSafeStorage["Service"],
  body: (
    account: DesktopAccount.DesktopAccount["Service"],
    opened: Queue.Queue<string>,
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const opened = yield* Queue.unbounded<string>();
    return yield* DesktopAccount.DesktopAccount.pipe(
      Effect.flatMap((account) => body(account, opened)),
      Effect.provide(layerAccount(stateDir, relay, safeStorage, opened)),
    );
  });

/** The next browser open never returns, like a system browser that is slow to launch. */
let hangNextBrowser = false;

const layerAccount = (
  stateDir: string,
  relay: FakeRelay,
  safeStorage: ElectronSafeStorage.ElectronSafeStorage["Service"],
  opened: Queue.Queue<string>,
) =>
  Layer.effect(DesktopAccount.DesktopAccount, DesktopAccount.make(relay.url)).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
          stateDir,
          isDevelopment: true,
        } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]),
        Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, safeStorage),
        Layer.succeed(
          ElectronShell.ElectronShell,
          ElectronShell.ElectronShell.of({
            openExternal: (url) =>
              Queue.offer(opened, String(url)).pipe(
                Effect.andThen(
                  Effect.suspend(() => {
                    if (!hangNextBrowser) return Effect.succeed(true);
                    hangNextBrowser = false;
                    return Effect.never;
                  }),
                ),
              ),
            openSystemSettings: () => Effect.succeed(false),
            copyText: () => Effect.void,
          }),
        ),
      ),
    ),
  );

/** Starts a sign-in and waits until the browser was opened; returns the running sign-in. */
const openSignIn = (
  account: DesktopAccount.DesktopAccount["Service"],
  relay: FakeRelay,
  opened: Queue.Queue<string>,
) =>
  Effect.gen(function* () {
    const signIn = yield* Effect.forkChild(account.startSignIn);
    const authorize = new URL(yield* Queue.take(opened));
    relay.challenge = authorize.searchParams.get("code_challenge");
    return { signIn, authorize, state: authorize.searchParams.get("state")! };
  });

const withTempState = <A, E, R>(body: (stateDir: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const stateDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "vekrel-desktop-account-test-",
    });
    return yield* body(stateDir);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

const encrypted = safeStorageWith({ available: true });

describe("DesktopAccount", () => {
  it("routes only this build's callback scheme", () => {
    assert.isTrue(DesktopAccount.isAccountCallbackUrl("vekrel-dev://auth/callback?code=x", true));
    assert.isTrue(DesktopAccount.isAccountCallbackUrl("vekrel://auth/callback", false));
    assert.isFalse(DesktopAccount.isAccountCallbackUrl("vekrel://auth/callback", true));
    assert.isFalse(DesktopAccount.isAccountCallbackUrl("vekrel-dev://app/auth/callback", true));
    assert.isFalse(DesktopAccount.isAccountCallbackUrl("vekrel-dev://auth/callback/x", true));
    assert.isFalse(DesktopAccount.isAccountCallbackUrl("https://auth/callback", true));
  });

  it.live("ignores a callback with a foreign state and completes on the right one", () =>
    withTempState((stateDir) =>
      Effect.gen(function* () {
        const relay = yield* fakeRelay;
        yield* withAccount(stateDir, relay, encrypted, (account, opened) =>
          Effect.gen(function* () {
            const { signIn, authorize, state } = yield* openSignIn(account, relay, opened);
            assert.strictEqual(
              `${authorize.origin}${authorize.pathname}`,
              `${relay.url}/oauth/authorize`,
            );
            assert.strictEqual(authorize.searchParams.get("client_id"), "vekrel-desktop");
            assert.strictEqual(
              authorize.searchParams.get("redirect_uri"),
              "vekrel-dev://auth/callback",
            );
            assert.strictEqual(authorize.searchParams.get("code_challenge_method"), "S256");

            // Ours (the scheme) but not this sign-in: taken, dropped, nothing redeemed.
            assert.strictEqual(
              account.receiveCallback("vekrel-dev://auth/callback?code=code-1&state=forged"),
              "ignored",
            );
            assert.strictEqual(
              account.receiveCallback("vekrel-dev://auth/callback?code=code-1"),
              "ignored",
            );
            assert.strictEqual(account.receiveCallback("vekrel-dev://app/welcome"), "not-account");

            assert.strictEqual(
              account.receiveCallback(`vekrel-dev://auth/callback?code=code-1&state=${state}`),
              "resolved",
            );
            // The same callback again (a replayed link) no longer matches anything.
            assert.strictEqual(
              account.receiveCallback(`vekrel-dev://auth/callback?code=code-1&state=${state}`),
              "ignored",
            );
            yield* Fiber.join(signIn);
            assert.deepStrictEqual(
              relay.requests.map((request) => request.grant_type),
              ["authorization_code"],
            );
            assert.strictEqual(yield* account.getAccessToken, "access-1");
          }),
        );
      }),
    ),
  );

  it.live("keeps the refresh token encrypted in the state dir across a restart", () =>
    withTempState((stateDir) =>
      Effect.gen(function* () {
        const relay = yield* fakeRelay;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* withAccount(stateDir, relay, encrypted, (account, opened) =>
          Effect.gen(function* () {
            const { signIn, state } = yield* openSignIn(account, relay, opened);
            account.receiveCallback(`vekrel-dev://auth/callback?code=code-1&state=${state}`);
            yield* Fiber.join(signIn);
          }),
        );
        const stored = yield* fileSystem.readFileString(`${stateDir}/account-refresh-token.bin`);
        assert.isTrue(stored.startsWith("enc:"));
        assert.notInclude(stored, "refresh-1");
        const mode = (yield* fileSystem.stat(`${stateDir}/account-refresh-token.bin`)).mode;
        assert.strictEqual(mode & 0o777, 0o600);

        // A new process: the stored token refreshes, and the rotated one is stored.
        yield* withAccount(stateDir, relay, encrypted, (account) =>
          Effect.gen(function* () {
            assert.strictEqual(yield* account.getAccessToken, "access-2");
          }),
        );
        assert.strictEqual(relay.requests.at(-1)?.refresh_token, "refresh-1");
        assert.strictEqual(relay.current, "refresh-2");

        // Sign-out revokes the current token first, then deletes the file.
        yield* withAccount(stateDir, relay, encrypted, (account) =>
          Effect.gen(function* () {
            yield* account.signOut;
            assert.isNull(yield* account.getAccessToken);
          }),
        );
        assert.deepInclude(relay.requests, {
          path: "/oauth/revoke",
          token: "refresh-2",
          client_id: "vekrel-desktop",
        });
        assert.isNull(relay.current);
        assert.isFalse(yield* fileSystem.exists(`${stateDir}/account-refresh-token.bin`));
      }),
    ),
  );

  it.live.each([
    { name: "no OS encryption", storage: safeStorageWith({ available: false }) },
    {
      name: "Linux basic_text",
      storage: safeStorageWith({ available: true, backend: "basic_text" }),
    },
  ])("never writes the token to disk with $name; signed out after a restart", ({ storage }) =>
    withTempState((stateDir) =>
      Effect.gen(function* () {
        const relay = yield* fakeRelay;
        relay.expiresIn = 1;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* withAccount(stateDir, relay, storage, (account, opened) =>
          Effect.gen(function* () {
            const { signIn, state } = yield* openSignIn(account, relay, opened);
            account.receiveCallback(`vekrel-dev://auth/callback?code=code-1&state=${state}`);
            yield* Fiber.join(signIn);
            // Kept in memory, the token still refreshes for this process.
            assert.strictEqual(yield* account.getAccessToken, "access-2");
          }),
        );
        assert.deepStrictEqual(yield* fileSystem.readDirectory(stateDir), []);
        yield* withAccount(stateDir, relay, storage, (account) =>
          Effect.gen(function* () {
            assert.isNull(yield* account.getAccessToken);
          }),
        );
      }),
    ),
  );

  it.live("a newer sign-in supersedes an older one", () =>
    withTempState((stateDir) =>
      Effect.gen(function* () {
        const relay = yield* fakeRelay;
        yield* withAccount(stateDir, relay, encrypted, (account, opened) =>
          Effect.gen(function* () {
            const first = yield* openSignIn(account, relay, opened);
            const second = yield* openSignIn(account, relay, opened);
            const exit = yield* Fiber.await(first.signIn);
            assert.isTrue(exit._tag === "Failure");
            // The first state no longer completes anything; the second one still can.
            assert.strictEqual(
              account.receiveCallback(
                `vekrel-dev://auth/callback?code=code-1&state=${first.state}`,
              ),
              "ignored",
            );
            assert.strictEqual(
              account.receiveCallback(
                `vekrel-dev://auth/callback?code=code-1&state=${second.state}`,
              ),
              "resolved",
            );
            yield* Fiber.join(second.signIn);
            assert.strictEqual(relay.requests.length, 1);
          }),
        );
      }),
    ),
  );

  it.live("superseding a sign-in whose browser is still opening rejects nothing unhandled", () =>
    withTempState((stateDir) =>
      Effect.gen(function* () {
        const relay = yield* fakeRelay;
        const unhandled: Array<unknown> = [];
        const onUnhandled = (reason: unknown) => void unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);
        yield* withAccount(stateDir, relay, encrypted, (account, opened) =>
          Effect.gen(function* () {
            hangNextBrowser = true;
            // Nothing awaits the first sign-in's callback yet: it is still inside openExternal.
            const first = yield* openSignIn(account, relay, opened);
            const second = yield* openSignIn(account, relay, opened);
            yield* Effect.yieldNow;
            yield* Effect.yieldNow;
            assert.deepStrictEqual(unhandled, []);
            yield* Fiber.interrupt(first.signIn);
            assert.strictEqual(
              account.receiveCallback(
                `vekrel-dev://auth/callback?code=code-1&state=${second.state}`,
              ),
              "resolved",
            );
            yield* Fiber.join(second.signIn);
          }),
        ).pipe(Effect.ensuring(Effect.sync(() => process.off("unhandledRejection", onUnhandled))));
      }),
    ),
  );
});
