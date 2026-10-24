import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const ORIGIN = "http://localhost:5733";
const RELAY = "http://localhost:8787";

function fakeJwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/u, "");
  return `${part({ alg: "EdDSA", typ: "JWT" })}.${part(claims)}.sig`;
}

const token = fakeJwt({ sub: "user-1", email: "a@example.test" });

class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: (() => void) | null = null;
  constructor() {
    FakeChannel.all.push(this);
  }
  postMessage() {
    for (const other of FakeChannel.all) if (other !== this) other.onmessage?.();
  }
}

let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;
let replaceState: ReturnType<typeof vi.fn>;
// Order of URL rewrites and relay requests, to check the code leaves the address bar first.
let events: string[];
let refreshAnswer: () => Promise<Response>;

beforeEach(() => {
  vi.resetModules();
  FakeChannel.all = [];
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  assign = vi.fn();
  events = [];
  replaceState = vi.fn((_state: unknown, _title: string, url: string) =>
    events.push(`replace ${url}`),
  );
  vi.stubGlobal("window", {
    location: Object.assign(new URL(`${ORIGIN}/settings`), { assign }),
    history: { state: null, replaceState },
  });
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  vi.stubEnv("VITE_VEKREL_RELAY_URL", RELAY);
  // No cookie yet: the relay refuses the refresh.
  refreshAnswer = async () => Response.json({ error: "invalid_grant" }, { status: 400 });
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = new URLSearchParams(init.body as string);
    events.push(`fetch ${body.get("grant_type") ?? "revoke"}`);
    if (url.endsWith("/oauth/token") && body.get("grant_type") === "authorization_code") {
      return Response.json({ access_token: token, expires_in: 600 });
    }
    if (body.get("grant_type") === "refresh_token") return refreshAnswer();
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Lets every queued promise reaction run (the relay fakes answer without timers). */
async function drainMicrotasks() {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
}

async function startedSignIn(returnTo?: string) {
  const auth = await import("./accountAuth");
  auth.startAccountSignIn(returnTo);
  const authorize = new URL(assign.mock.calls[0]![0] as string);
  const callback = `${ORIGIN}/auth/callback?code=code-1&state=${authorize.searchParams.get("state")}`;
  return { auth, authorize, callback };
}

describe("web account auth", () => {
  it("authorizes at the relay with this origin's callback", async () => {
    const { authorize } = await startedSignIn();

    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${RELAY}/oauth/authorize`);
    expect(authorize.searchParams.get("client_id")).toBe("vekrel-web");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/callback`);
  });

  it("exchanges the code with the cookie and returns to the page sign-in started on", async () => {
    const { auth, callback } = await startedSignIn(`${ORIGIN}/settings/connections?x=1#y`);

    await expect(auth.completeAccountSignIn(callback)).resolves.toBe("/settings/connections?x=1#y");
    const exchange = fetchMock.mock.calls.find(([, init]) =>
      String(init.body).includes("authorization_code"),
    )!;
    expect(exchange[1].credentials).toBe("include");
    await expect(auth.getAccountToken()).resolves.toBe(token);
  });

  it("uses a pending sign-in once, so a reloaded callback cannot replay it", async () => {
    const { auth, callback } = await startedSignIn();

    await auth.completeAccountSignIn(callback);
    await expect(auth.completeAccountSignIn(callback)).rejects.toThrow(/not started in this tab/u);
  });

  it("never returns to another origin", async () => {
    const { auth, callback } = await startedSignIn("https://evil.example.test/steal");

    await expect(auth.completeAccountSignIn(callback)).resolves.toBe("/");
  });

  it("refuses a callback whose state is not this tab's", async () => {
    const { auth } = await startedSignIn();

    await expect(
      auth.completeAccountSignIn(`${ORIGIN}/auth/callback?code=code-1&state=forged`),
    ).rejects.toThrow(/does not belong/u);
  });

  it("wakes a signed-out tab when another tab signs in", async () => {
    const { auth, callback } = await startedSignIn();
    await expect(auth.getAccountToken()).resolves.toBeNull();
    const refreshes = () =>
      fetchMock.mock.calls.filter(([, init]) => String(init.body).includes("refresh_token")).length;
    const before = refreshes();

    // Another tab: same cookie jar, its own session and channel.
    new FakeChannel().postMessage();
    await vi.waitFor(() => expect(refreshes()).toBe(before + 1));
    // This tab's own completion also announces; it must not throw.
    await auth.completeAccountSignIn(callback);
  });

  it("takes code and state out of the address bar before the exchange", async () => {
    const { auth, callback } = await startedSignIn();
    events.length = 0;

    await auth.completeAccountSignIn(callback);
    expect(events[0]).toBe("replace /auth/callback");
    expect(events).toContain("fetch authorization_code");
  });

  it("takes code and state out of the address bar when the sign-in fails", async () => {
    const auth = await import("./accountAuth");

    await expect(
      auth.completeAccountSignIn(`${ORIGIN}/auth/callback?code=c&state=s`),
    ).rejects.toThrow();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/auth/callback");
  });

  it.each([`${ORIGIN}//evil.example.test/x`, `${ORIGIN}/\\evil.example.test/x`])(
    "never returns to a protocol-relative path: %s",
    async (returnTo) => {
      const { auth, callback } = await startedSignIn(returnTo);

      await expect(auth.completeAccountSignIn(callback)).resolves.toBe("/");
    },
  );

  it("ignores a sign-out from a session another tab's announcement replaced", async () => {
    const { auth, callback } = await startedSignIn();
    const stale = fakeJwt({ sub: "user-1", email: "a@example.test", exp: 1 });
    const answer = fetchMock.getMockImplementation() as (
      url: string,
      init: RequestInit,
    ) => Promise<Response>;
    // The code exchange expires at once (inside the 30 s skew), so the next read refreshes.
    fetchMock.mockImplementation(async (url: string, init: RequestInit) =>
      String(init.body).includes("authorization_code")
        ? Response.json({ access_token: stale, expires_in: 1 })
        : answer(url, init),
    );
    await auth.completeAccountSignIn(callback);
    let refuse!: () => void;
    refreshAnswer = () =>
      new Promise((resolve) => {
        refuse = () => resolve(Response.json({ error: "invalid_grant" }, { status: 400 }));
      });
    const staleRead = auth.getAccountToken();
    await vi.waitFor(() => expect(refuse).toBeTypeOf("function"));

    // Another tab signed in again: this tab's new session reads a fresh cookie.
    refreshAnswer = async () => Response.json({ access_token: token, expires_in: 600 });
    new FakeChannel().postMessage();
    await vi.waitFor(() => expect(auth.getAccountAuthState().isSignedIn).toBe(true));

    refuse();
    await staleRead;
    expect(auth.getAccountAuthState().isSignedIn).toBe(true);
  });

  it("on the callback, no cookie read races the code exchange", async () => {
    // Web Locks grant asynchronously, as in a browser, so the exchange starts during the wait.
    vi.stubGlobal("navigator", {
      locks: {
        request: async (_name: string, callback: () => Promise<unknown>) => {
          await Promise.resolve();
          return callback();
        },
      },
    });
    const { auth, callback } = await startedSignIn();
    (window.location as unknown as URL).pathname = "/auth/callback";

    await auth.completeAccountSignIn(callback);
    await drainMicrotasks();
    expect(auth.getAccountAuthState().isSignedIn).toBe(true);
    expect(events.filter((event) => event === "fetch refresh_token")).toEqual([]);
  });

  it("a cookie read started before the sign-in cannot sign the callback page out", async () => {
    const { auth, callback } = await startedSignIn();
    let refuse!: () => void;
    // The callback page's first cookie read (no cookie yet) answers after the exchange.
    refreshAnswer = () =>
      new Promise((resolve) => {
        refuse = () => resolve(Response.json({ error: "invalid_grant" }, { status: 400 }));
      });

    await auth.completeAccountSignIn(callback);
    expect(auth.getAccountAuthState().isSignedIn).toBe(true);
    refuse();
    await vi.waitFor(() => expect(fetchMock.mock.results.length).toBeGreaterThan(1));
    await drainMicrotasks();
    expect(auth.getAccountAuthState().isSignedIn).toBe(true);
  });
});

describe("desktop shell account (window.desktopAccount)", () => {
  let desktopToken: string | null;
  let desktop: {
    startSignIn: ReturnType<typeof vi.fn>;
    getAccessToken: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    desktopToken = null;
    desktop = {
      startSignIn: vi.fn(async () => {
        desktopToken = token;
      }),
      getAccessToken: vi.fn(async () => desktopToken),
      signOut: vi.fn(async () => {
        desktopToken = null;
      }),
    };
    Object.assign(window, { desktopBridge: {}, desktopAccount: desktop });
  });

  const loaded = () => import("./accountAuth");

  it("reads the signed-in state from the desktop, never the relay cookie", async () => {
    desktopToken = token;
    const auth = await loaded();

    await expect(auth.getAccountToken()).resolves.toBe(token);
    expect(auth.getAccountAuthState()).toMatchObject({
      isLoaded: true,
      isSignedIn: true,
      userId: "user-1",
      email: "a@example.test",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeChannel.all).toEqual([]);
  });

  it("signs in through the desktop, not a page navigation", async () => {
    const auth = await loaded();

    auth.startAccountSignIn();
    await vi.waitFor(() => expect(auth.getAccountAuthState().isSignedIn).toBe(true));
    expect(desktop.startSignIn).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed or superseded sign-in leaves the state signed out", async () => {
    desktop.startSignIn.mockRejectedValueOnce(new Error("superseded"));
    const auth = await loaded();

    auth.startAccountSignIn();
    await drainMicrotasks();
    expect(auth.getAccountAuthState().isSignedIn).toBe(false);
  });

  it("signs out through the desktop; a token read from before cannot sign back in", async () => {
    desktopToken = token;
    const auth = await loaded();
    await auth.getAccountToken();
    let answer!: (value: string) => void;
    desktop.getAccessToken.mockImplementationOnce(
      () => new Promise<string>((resolve) => (answer = resolve)),
    );
    const staleRead = auth.getAccountToken();

    await auth.signOutAccount();
    answer(token);
    await staleRead;
    expect(desktop.signOut).toHaveBeenCalledOnce();
    expect(auth.getAccountAuthState().isSignedIn).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
