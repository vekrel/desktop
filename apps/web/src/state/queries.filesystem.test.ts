import { AuthFilesystemReadScope, MachineId, type AuthSessionState } from "@vekrel/contracts";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  session: null as Pick<AuthSessionState, "authenticated" | "scopes"> | null,
  sessionError: null as string | null,
  sessionWaiting: false,
  phase: "connected" as "connected" | "offline",
  sessionAtom: {},
  searchAtom: {},
  contentAtom: {},
  contentRequests: vi.fn(),
  contentError: null as string | null,
  contentData: {
    matches: [{ path: "src/index.ts", lineNumber: 3, lineContent: "a match", matchRanges: [] }],
    truncated: false,
  },
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <A>(callback: A) => callback,
  useEffect: () => {},
  useMemo: <A>(factory: () => A) => factory(),
  useState: <A>(value: A) => [value, vi.fn()],
}));
vi.mock("./session", () => ({
  machineSession: { sessionStateAtom: () => state.sessionAtom },
}));
vi.mock("./presentation", () => ({
  useMachinePresentation: () => ({
    isReady: true,
    presentation: { connection: { phase: state.phase, error: null } },
  }),
}));
vi.mock("./projects", () => ({
  projectMachine: { searchEntries: () => state.searchAtom },
  projectContentSearch: (target: unknown) => {
    state.contentRequests(target);
    return state.contentAtom;
  },
}));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("./orchestration", () => ({ orchestrationMachine: {} }));
vi.mock("./threads", () => ({ useMachineThread: vi.fn() }));
vi.mock("./vcs", () => ({ vcsMachine: {} }));
vi.mock("./query", () => ({
  useMachineQuery: (atom: unknown) => ({
    data:
      atom === state.sessionAtom
        ? state.session
        : atom === state.searchAtom
          ? { entries: [{ path: "src/index.ts", kind: "file" }] }
          : atom === state.contentAtom
            ? state.contentData
            : null,
    error:
      atom === state.sessionAtom
        ? state.sessionError
        : atom === state.contentAtom
          ? state.contentError
          : null,
    isPending:
      atom === state.sessionAtom &&
      (state.sessionWaiting || (state.session === null && state.sessionError === null)),
    refresh: vi.fn(),
  }),
}));

import { useProjectContentSearch } from "./queries";

const target = {
  machineId: MachineId.make("test-machine"),
  cwd: "/repo",
  query: "src",
};

beforeEach(() => {
  state.session = null;
  state.sessionError = null;
  state.sessionWaiting = false;
  state.phase = "connected";
  state.contentRequests.mockClear();
  state.contentError = null;
});

const contentTarget = {
  ...target,
  query: " a match ",
  caseSensitive: true,
  wholeWord: true,
  useRegex: false,
};

it("shows content-search denial before typing and never issues an unauthorized request", () => {
  state.session = { authenticated: true, scopes: [] };
  for (const query of ["", contentTarget.query]) {
    const result = useProjectContentSearch({ ...contentTarget, query });
    expect(state.contentRequests).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      canReadFiles: false,
      isCheckingAccess: false,
      matches: [],
      error: "This connection cannot search host files.",
      isPending: false,
    });
  }
  expect(state.contentRequests).not.toHaveBeenCalled();
});

it("keeps confirmed content access during revalidation and drops results when it is revoked", () => {
  state.session = { authenticated: true, scopes: [AuthFilesystemReadScope] };
  state.sessionWaiting = true;
  expect(useProjectContentSearch(contentTarget)).toMatchObject({
    matches: state.contentData.matches,
    isPending: false,
  });

  state.contentRequests.mockClear();
  state.sessionWaiting = false;
  state.session = { authenticated: true, scopes: [] };
  const result = useProjectContentSearch(contentTarget);
  expect(state.contentRequests).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    canReadFiles: false,
    matches: [],
    error: "This connection cannot search host files.",
    isPending: false,
  });
  expect(state.contentRequests).not.toHaveBeenCalled();
});

it("fails closed after a session check fails, even with a cached grant and matches", () => {
  state.session = { authenticated: true, scopes: [AuthFilesystemReadScope] };
  state.sessionError = "The session has expired.";
  const result = useProjectContentSearch(contentTarget);
  expect(state.contentRequests).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    canReadFiles: false,
    matches: [],
    error: state.sessionError,
    isPending: false,
  });
  expect(state.contentRequests).not.toHaveBeenCalled();
});
