/**
 * The Vekrel account in the desktop app (plan 6A Task 16). Sign-in opens the system browser at
 * the relay's `/oauth/authorize` (client `vekrel-desktop`, PKCE S256); the relay redirects to
 * `vekrel://auth/callback` (`vekrel-dev://` in development), which reaches `receiveCallback`.
 *
 * The session lives in the main process: the relay's `/oauth/token` only answers cross-origin
 * requests from the web app, so the `vekrel://app` renderer could not refresh by itself. The
 * renderer gets short-lived access tokens; the refresh token never leaves this process and is
 * kept encrypted with Electron `safeStorage` in the state directory.
 */
import {
  AccountClientId,
  beginSignIn,
  createAccountSession,
  normalizeAccountRelayUrl,
  type AccountSession,
  type PendingSignIn,
  type RefreshTokenStore,
} from "@vekrel/client-runtime/account-auth";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

declare const __VEKREL_BUILD_RELAY_URL__: string | undefined;

const REFRESH_TOKEN_FILE = "account-refresh-token.bin";
/** The relay's authorize request lives 10 min; a callback after that cannot be redeemed. */
const SIGN_IN_TIMEOUT = "10 minutes";

export class DesktopAccountError extends Schema.TaggedError<DesktopAccountError>()(
  "DesktopAccountError",
  {
    reason: Schema.Literals([
      "not-configured",
      "browser-failed",
      "superseded",
      "timed-out",
      "sign-in-failed",
      "token-failed",
      "sign-out-failed",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Vekrel account: ${this.reason}.`;
  }
}

const isDesktopAccountError = Schema.is(DesktopAccountError);

export function accountRedirectUri(isDevelopment: boolean): string {
  return `${ElectronProtocol.getDesktopScheme(isDevelopment)}://auth/callback`;
}

/** `<scheme>://auth/callback` of this build, with any query. */
export function isAccountCallbackUrl(value: string, isDevelopment: boolean): boolean {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}` === accountRedirectUri(isDevelopment);
  } catch {
    return false;
  }
}

function buildRelayUrl(): string | null {
  const value = typeof __VEKREL_BUILD_RELAY_URL__ === "undefined" ? "" : __VEKREL_BUILD_RELAY_URL__;
  try {
    return value.trim() ? normalizeAccountRelayUrl(value) : null;
  } catch {
    return null;
  }
}

/**
 * The refresh token, encrypted with `safeStorage` in `<stateDir>/account-refresh-token.bin`.
 * Without OS encryption (no keychain/DPAPI, or Linux's `basic_text` fallback, which uses a fixed
 * key) it is never written to disk: it stays in memory, so the session lasts until the app quits
 * and the next launch starts signed out.
 */
export const makeRefreshTokenStore = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const tokenPath = path.join(environment.stateDir, REFRESH_TOKEN_FILE);
  let memoryToken: string | null = null;

  const canEncrypt = Effect.gen(function* () {
    const available = yield* safeStorage.isEncryptionAvailable.pipe(
      Effect.orElseSucceed(() => false),
    );
    const backend = yield* safeStorage.selectedStorageBackend;
    return available && Option.getOrUndefined(backend) !== "basic_text";
  });

  const read = Effect.gen(function* () {
    if (!(yield* canEncrypt)) return memoryToken;
    const bytes = yield* fileSystem.readFile(tokenPath).pipe(
      Effect.map(Option.some),
      Effect.catch((error) =>
        error.reason._tag === "NotFound" ? Effect.succeedNone : Effect.fail(error),
      ),
    );
    if (Option.isNone(bytes)) return null;
    // A token this keychain cannot decrypt (OS key reset, copied profile) reads as signed out.
    return yield* safeStorage
      .decryptString(bytes.value)
      .pipe(
        Effect.catch(() =>
          Effect.logWarning("Could not decrypt the stored account token.").pipe(Effect.as(null)),
        ),
      );
  });

  const write = Effect.fn("DesktopAccount.writeRefreshToken")(function* (token: string) {
    if (!(yield* canEncrypt)) {
      memoryToken = token;
      yield* Effect.logWarning(
        "OS encryption is unavailable; the account stays signed in only until the app quits.",
      );
      return;
    }
    const encrypted = yield* safeStorage.encryptString(token);
    const tempPath = `${tokenPath}.${process.pid}.tmp`;
    yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
    yield* fileSystem
      .writeFile(tempPath, encrypted, { mode: 0o600 })
      .pipe(
        Effect.andThen(fileSystem.rename(tempPath, tokenPath)),
        Effect.ensuring(fileSystem.remove(tempPath, { force: true }).pipe(Effect.ignore)),
      );
  });

  const clear = Effect.gen(function* () {
    memoryToken = null;
    yield* fileSystem.remove(tokenPath, { force: true });
  });

  return { read, write, clear };
});

export type AccountCallbackResult = "resolved" | "ignored" | "not-account";

export class DesktopAccount extends Context.Service<
  DesktopAccount,
  {
    /** Opens the relay sign-in in the system browser; resolves once the session is stored. */
    readonly startSignIn: Effect.Effect<void, DesktopAccountError>;
    /**
     * `resolved`: the callback of the pending sign-in. `ignored`: a `<scheme>://auth/callback`
     * link for another (or no) sign-in, taken and dropped. `not-account`: any other link.
     */
    readonly receiveCallback: (url: string) => AccountCallbackResult;
    /** A current access token, or null when signed out (or no relay is configured). */
    readonly getAccessToken: Effect.Effect<string | null, DesktopAccountError>;
    /** Revokes the refresh token at the relay, then deletes it here. */
    readonly signOut: Effect.Effect<void, DesktopAccountError>;
  }
>()("@vekrel/desktop/app/DesktopAccount") {}

interface PendingCallback {
  readonly signIn: PendingSignIn;
  readonly callback: PromiseWithResolvers<string>;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("DesktopAccount.make")(function* (
  relayUrl: string | null = buildRelayUrl(),
) {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const shell = yield* ElectronShell.ElectronShell;
  const tokens = yield* makeRefreshTokenStore;
  const store: RefreshTokenStore = {
    read: () => Effect.runPromise(tokens.read),
    write: (token) => Effect.runPromise(tokens.write(token)),
    clear: () => Effect.runPromise(tokens.clear),
  };
  // One session for every window: its refreshes are single-flight, so the rotating refresh
  // token is never presented twice.
  const session: AccountSession | null = relayUrl
    ? createAccountSession({ relayUrl, clientId: AccountClientId.desktop, store })
    : null;
  let pending: PendingCallback | null = null;

  const awaitCallback = (current: PendingCallback) =>
    Effect.tryPromise({
      try: () => current.callback.promise,
      catch: (cause) =>
        isDesktopAccountError(cause)
          ? cause
          : new DesktopAccountError({ reason: "sign-in-failed", cause }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: SIGN_IN_TIMEOUT,
        orElse: () => Effect.fail(new DesktopAccountError({ reason: "timed-out" })),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          if (pending === current) pending = null;
        }),
      ),
    );

  const startSignIn = Effect.gen(function* () {
    if (!session || !relayUrl) {
      return yield* new DesktopAccountError({ reason: "not-configured" });
    }
    const { url, pending: signIn } = beginSignIn({
      relayUrl,
      clientId: AccountClientId.desktop,
      redirectUri: accountRedirectUri(environment.isDevelopment),
    });
    // Only the newest sign-in can complete; an older window's request gives up.
    pending?.callback.reject(new DesktopAccountError({ reason: "superseded" }));
    const current: PendingCallback = { signIn, callback: Promise.withResolvers<string>() };
    // Superseded before anything awaits it (browser still opening): not an unhandled rejection.
    current.callback.promise.catch(() => undefined);
    pending = current;
    if (!(yield* shell.openExternal(url))) {
      if (pending === current) pending = null;
      return yield* new DesktopAccountError({ reason: "browser-failed" });
    }
    const callbackUrl = yield* awaitCallback(current);
    // Checks state again, then redeems the code with the PKCE verifier and stores the token.
    yield* Effect.tryPromise({
      try: () => session.completeSignIn(callbackUrl, signIn),
      catch: (cause) => new DesktopAccountError({ reason: "sign-in-failed", cause }),
    });
  }).pipe(Effect.withSpan("desktop.account.startSignIn"));

  const receiveCallback = (url: string): AccountCallbackResult => {
    if (!isAccountCallbackUrl(url, environment.isDevelopment)) return "not-account";
    const current = pending;
    // A callback for another (or no) sign-in is dropped: it is not ours to redeem.
    if (!current || new URL(url).searchParams.get("state") !== current.signIn.state) {
      return "ignored";
    }
    pending = null;
    current.callback.resolve(url);
    return "resolved";
  };

  const getAccessToken = session
    ? Effect.tryPromise({
        try: () => session.getAccessToken(),
        catch: (cause) => new DesktopAccountError({ reason: "token-failed", cause }),
      })
    : Effect.succeed(null);

  const signOut = session
    ? Effect.tryPromise({
        try: () => session.signOut(),
        catch: (cause) => new DesktopAccountError({ reason: "sign-out-failed", cause }),
      })
    : Effect.void;

  return DesktopAccount.of({ startSignIn, receiveCallback, getAccessToken, signOut });
});

export const layer = Layer.effect(DesktopAccount, make());
