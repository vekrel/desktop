import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  type MachineId,
  type ProjectListEntriesResult,
  ProjectReadFileError,
  type ProjectReadFileResult,
  VEKREL_PROJECT_FILE_NAME,
} from "@vekrel/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useFilesystemReadAccess } from "~/state/filesystem";
import { projectMachine } from "~/state/projects";
import { useProjectPathSearch } from "~/state/queries";
import { executeAtomQuery } from "@vekrel/client-runtime/state/runtime";

const EMPTY_PROJECT_FILE_PATH = "";
const EMPTY_PROJECT_ENTRIES_QUERY_ATOM = Atom.make(
  AsyncResult.initial<ProjectListEntriesResult, never>(false),
);
const EMPTY_PROJECT_FILE_QUERY_ATOM = Atom.make(
  AsyncResult.initial<ProjectReadFileResult, never>(false),
).pipe(Atom.withLabel("project-file-query:empty"));
export function optimisticFileAtom(machineId: MachineId, cwd: string, relativePath: string) {
  return projectMachine.optimisticFile({ machineId, cwd, relativePath });
}

// Dirty contents must survive a closed preview, including failed or unauthorized saves.
const unsavedFileMounts = new Map<ReturnType<typeof optimisticFileAtom>, () => void>();

function releaseUnsavedFile(atom: ReturnType<typeof optimisticFileAtom>): void {
  const unmount = unsavedFileMounts.get(atom);
  unsavedFileMounts.delete(atom);
  unmount?.();
}

interface ProjectQueryState<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

interface ProjectFileQueryState extends ProjectQueryState<ProjectReadFileResult> {
  readonly readError: ProjectReadFileError | null;
  readonly isNotFile: boolean;
  readonly isFile: boolean;
}

function getProjectEntriesQueryAtom(machineId: MachineId, cwd: string, directoryPath?: string) {
  return projectMachine.listEntries({
    machineId,
    input: { cwd, ...(directoryPath !== undefined ? { directoryPath } : {}) },
  });
}

export function getProjectFileQueryAtom(
  machineId: MachineId,
  cwd: string,
  relativePath: string | null,
) {
  return projectMachine.readFile({
    machineId,
    input: {
      cwd,
      relativePath: relativePath ?? EMPTY_PROJECT_FILE_PATH,
      ...(relativePath === VEKREL_PROJECT_FILE_NAME ? { allowMissing: true } : {}),
    },
  });
}

export function setProjectFileQueryData(
  machineId: MachineId,
  cwd: string,
  relativePath: string,
  contents: string,
): void {
  const atom = optimisticFileAtom(machineId, cwd, relativePath);
  if (!unsavedFileMounts.has(atom)) {
    unsavedFileMounts.set(atom, appAtomRegistry.mount(atom));
  }
  appAtomRegistry.set(atom, {
    confirmedAgainst: undefined,
    data: {
      relativePath,
      contents,
      byteLength: new TextEncoder().encode(contents).byteLength,
      truncated: false,
    },
  });
}

export function getOptimisticProjectFileQueryData(
  machineId: MachineId,
  cwd: string,
  relativePath: string,
): ProjectReadFileResult | null {
  return appAtomRegistry.get(optimisticFileAtom(machineId, cwd, relativePath))?.data ?? null;
}

export function getProjectFileContents(
  machineId: MachineId,
  cwd: string,
  relativePath: string,
): string | undefined {
  const optimistic = getOptimisticProjectFileQueryData(machineId, cwd, relativePath);
  if (optimistic) return optimistic.contents;
  const result = appAtomRegistry.get(getProjectFileQueryAtom(machineId, cwd, relativePath));
  const data = Option.getOrUndefined(AsyncResult.value(result));
  return data?.exists === false ? undefined : data?.contents;
}

export function getUnsavedProjectFileQueryData(
  machineId: MachineId,
  cwd: string,
  relativePath: string,
): ProjectReadFileResult | null {
  const optimistic = appAtomRegistry.get(optimisticFileAtom(machineId, cwd, relativePath));
  return optimistic?.confirmedAgainst === undefined ? (optimistic?.data ?? null) : null;
}

export function confirmProjectFileQueryData(
  machineId: MachineId,
  cwd: string,
  relativePath: string,
  contents: string,
): boolean {
  const atom = optimisticFileAtom(machineId, cwd, relativePath);
  const optimisticFile = appAtomRegistry.get(atom);
  if (optimisticFile?.data.contents !== contents) return false;

  const queryAtom = getProjectFileQueryAtom(machineId, cwd, relativePath);
  const confirmed = {
    ...optimisticFile,
    confirmedAgainst: appAtomRegistry.get(queryAtom),
  };
  appAtomRegistry.set(atom, confirmed);
  releaseUnsavedFile(atom);
  appAtomRegistry.refresh(queryAtom);
  void executeAtomQuery(appAtomRegistry, queryAtom, {
    reportDefect: false,
    reportFailure: false,
  }).then((result) => {
    if (result._tag === "Success" && appAtomRegistry.get(atom) === confirmed) {
      appAtomRegistry.set(atom, null);
    }
  });
  return true;
}

export function resolveProjectFileQueryData(
  machineId: MachineId,
  cwd: string,
  relativePath: string | null,
  data: ProjectReadFileResult | null,
): ProjectReadFileResult | null {
  if (relativePath === null) return data;
  return appAtomRegistry.get(optimisticFileAtom(machineId, cwd, relativePath))?.data ?? data;
}

export function clearProjectFileQueryData(
  machineId: MachineId,
  cwd: string,
  relativePath: string,
): void {
  const atom = optimisticFileAtom(machineId, cwd, relativePath);
  appAtomRegistry.set(atom, null);
  releaseUnsavedFile(atom);
}

function failureCause<A>(result: AsyncResult.AsyncResult<A, unknown>): unknown {
  return result._tag === "Failure" ? Cause.squash(result.cause) : null;
}

function errorMessage(cause: unknown): string | null {
  if (cause === null) return null;
  return cause instanceof Error ? cause.message : "Workspace query failed.";
}

const isProjectReadFileError = Schema.is(ProjectReadFileError);

export function useProjectEntriesQuery(
  machineId: MachineId,
  cwd: string,
  directoryPath?: string,
): ProjectQueryState<ProjectListEntriesResult> {
  const fileAccess = useFilesystemReadAccess(machineId);
  const { canReadFiles } = fileAccess;
  const atom = canReadFiles
    ? getProjectEntriesQueryAtom(machineId, cwd, directoryPath)
    : EMPTY_PROJECT_ENTRIES_QUERY_ATOM;
  const result = useAtomValue(atom);
  const refreshAtom = useAtomRefresh(atom);
  const refresh = () => refreshAtom();
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: fileAccess.isPending
      ? null
      : canReadFiles
        ? errorMessage(failureCause(result))
        : (fileAccess.error ?? "This connection cannot read host files."),
    isPending: fileAccess.isPending || result.waiting,
    refresh,
  };
}

/**
 * An empty query is a valid request — the index answers it with
 * frecency-ordered files, so the picker's initial view is recent files without
 * transferring the full workspace listing.
 */
export function useProjectFilePickerQuery(
  machineId: MachineId,
  cwd: string,
  query: string,
  limit: number,
  options?: { readonly imageOnly?: boolean },
) {
  const search = useProjectPathSearch(
    {
      machineId,
      cwd,
      query,
      kind: "file",
      ...(options?.imageOnly ? { imageOnly: true } : {}),
    },
    limit,
    { allowEmptyQuery: true },
  );

  return {
    entries: search.isPending ? [] : search.entries,
    error: search.error,
    isPending: search.isPending,
    matchedQuery: search.searchedQuery,
  };
}

export function useProjectFileQuery(
  machineId: MachineId,
  cwd: string,
  relativePath: string | null,
  enabled = true,
): ProjectFileQueryState {
  // A media path is not skipped here: a folder named `assets.png` is only
  // knowable as a folder from the read failure.
  const fileAccess = useFilesystemReadAccess(machineId);
  const { canReadFiles } = fileAccess;
  const isQueryEnabled = enabled;
  const atom =
    enabled && canReadFiles
      ? getProjectFileQueryAtom(machineId, cwd, relativePath)
      : EMPTY_PROJECT_FILE_QUERY_ATOM;
  const result = useAtomValue(atom);
  const refreshAtom = useAtomRefresh(atom);
  const refresh = () => refreshAtom();
  const readData = Option.getOrNull(AsyncResult.value(result));
  const isMissing = readData?.exists === false;
  const optimisticResult = useAtomValue(
    optimisticFileAtom(machineId, cwd, relativePath ?? EMPTY_PROJECT_FILE_PATH),
  );
  const optimisticFile = relativePath === null ? null : optimisticResult;
  const cause = failureCause(result);
  const readError = isProjectReadFileError(cause) ? cause : null;
  const data = canReadFiles ? (optimisticFile?.data ?? (isMissing ? null : readData)) : null;
  const isNotFile = readError?.failure === "path_not_file";

  return {
    data,
    error:
      !isQueryEnabled || fileAccess.isPending
        ? null
        : canReadFiles
          ? isMissing && !optimisticFile
            ? `'${relativePath}' does not exist.`
            : errorMessage(cause)
          : (fileAccess.error ?? "This connection cannot read host files."),
    isPending: isQueryEnabled && (fileAccess.isPending || result.waiting),
    readError,
    isNotFile,
    // A folder error overrides cached contents retained across failed refreshes.
    isFile: !isNotFile && (data !== null || readError?.failure === "binary_file"),
    refresh,
  };
}
