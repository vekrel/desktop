import { MachineId, type PersistedSavedMachineRecord } from "@vekrel/contracts";
import { fromLenientJson } from "@vekrel/shared/schemaJson";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";

type PersistedSavedMachineDesktopSsh = NonNullable<
  PersistedSavedMachineRecord["desktopSsh"]
>;

interface PersistedSavedMachineStorageRecord extends Omit<
  PersistedSavedMachineRecord,
  "desktopSsh"
> {
  readonly desktopSsh?: PersistedSavedMachineDesktopSsh;
  readonly encryptedBearerToken?: string;
}

interface SavedMachineRegistryDocument {
  readonly version: number;
  readonly records: readonly PersistedSavedMachineStorageRecord[];
}

interface SavedMachineRegistryStorageDocument {
  readonly version?: number;
  readonly records?: readonly PersistedSavedMachineStorageRecord[];
}

const DesktopSshTargetSchema = Schema.Struct({
  alias: Schema.String,
  hostname: Schema.String,
  username: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Number),
});

const PersistedSavedMachineStorageRecordSchema = Schema.Struct({
  machineId: MachineId,
  label: Schema.String,
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
  createdAt: Schema.String,
  lastConnectedAt: Schema.NullOr(Schema.String),
  desktopSsh: Schema.optionalKey(DesktopSshTargetSchema),
  relayManaged: Schema.optionalKey(Schema.Struct({ relayUrl: Schema.String })),
  encryptedBearerToken: Schema.optionalKey(Schema.String),
});

const SavedMachineRegistryDocumentSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Number),
  records: Schema.optionalKey(Schema.Array(PersistedSavedMachineStorageRecordSchema)),
});

const SavedMachineRegistryDocumentJson = fromLenientJson(
  SavedMachineRegistryDocumentSchema,
);
const decodeSavedMachineRegistryDocumentJson = Schema.decodeEffect(
  SavedMachineRegistryDocumentJson,
);

const DesktopSavedMachineSecretProtectionOperation = Schema.Literals([
  "check-encryption-availability",
  "decrypt-secret",
]);

export class DesktopSavedMachinesReadError extends Schema.TaggedError<DesktopSavedMachinesReadError>()(
  "DesktopSavedMachinesReadError",
  {
    registryPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read desktop saved machines at ${this.registryPath}.`;
  }
}

export class DesktopSavedMachinesDocumentDecodeError extends Schema.TaggedError<DesktopSavedMachinesDocumentDecodeError>()(
  "DesktopSavedMachinesDocumentDecodeError",
  {
    registryPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to decode desktop saved machines at ${this.registryPath}.`;
  }
}

export class DesktopSavedMachineSecretDecodeError extends Schema.TaggedError<DesktopSavedMachineSecretDecodeError>()(
  "DesktopSavedMachineSecretDecodeError",
  {
    machineId: Schema.String,
    registryPath: Schema.String,
    field: Schema.Literal("encryptedBearerToken"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to decode ${this.field} for machine ${this.machineId} at ${this.registryPath}.`;
  }
}

export class DesktopSavedMachineSecretProtectionError extends Schema.TaggedError<DesktopSavedMachineSecretProtectionError>()(
  "DesktopSavedMachineSecretProtectionError",
  {
    operation: DesktopSavedMachineSecretProtectionOperation,
    machineId: Schema.String,
    registryPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop saved-machine secret protection failed during ${this.operation} for machine ${this.machineId} at ${this.registryPath}.`;
  }
}

export type DesktopSavedMachinesReadRegistryError =
  | DesktopSavedMachinesReadError
  | DesktopSavedMachinesDocumentDecodeError;

export type DesktopSavedMachinesGetSecretError =
  | DesktopSavedMachinesReadRegistryError
  | DesktopSavedMachineSecretDecodeError
  | DesktopSavedMachineSecretProtectionError;

export class DesktopSavedMachines extends Context.Service<
  DesktopSavedMachines,
  {
    readonly getRegistry: Effect.Effect<
      readonly PersistedSavedMachineRecord[],
      DesktopSavedMachinesReadRegistryError
    >;

    readonly getSecret: (
      machineId: string,
    ) => Effect.Effect<Option.Option<string>, DesktopSavedMachinesGetSecretError>;
  }
>()("@vekrel/desktop/settings/DesktopSavedMachines") {}

function toPersistedSavedMachineRecord(
  record: PersistedSavedMachineStorageRecord,
): PersistedSavedMachineRecord {
  const nextRecord = {
    machineId: record.machineId,
    label: record.label,
    httpBaseUrl: record.httpBaseUrl,
    wsBaseUrl: record.wsBaseUrl,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
  };
  return {
    ...nextRecord,
    ...(record.desktopSsh ? { desktopSsh: record.desktopSsh } : {}),
    ...(record.relayManaged ? { relayManaged: record.relayManaged } : {}),
  };
}

function normalizeSavedMachineRegistryDocument(
  document: SavedMachineRegistryStorageDocument,
): SavedMachineRegistryDocument {
  return {
    version: document.version ?? 1,
    records: document.records ?? [],
  };
}

function readRegistryDocument(
  fileSystem: FileSystem.FileSystem,
  registryPath: string,
): Effect.Effect<SavedMachineRegistryDocument, DesktopSavedMachinesReadRegistryError> {
  return fileSystem.readFileString(registryPath).pipe(
    Effect.catch((error) =>
      error.reason._tag === "NotFound"
        ? Effect.succeed<string | null>(null)
        : Effect.fail(
            new DesktopSavedMachinesReadError({
              registryPath,
              cause: error,
            }),
          ),
    ),
    Effect.flatMap((raw) =>
      raw === null
        ? Effect.succeed({ version: 1, records: [] })
        : decodeSavedMachineRegistryDocumentJson(raw).pipe(
            Effect.map(normalizeSavedMachineRegistryDocument),
            Effect.mapError(
              (cause) =>
                new DesktopSavedMachinesDocumentDecodeError({
                  registryPath,
                  cause,
                }),
            ),
          ),
    ),
  );
}

function decodeSecretBytes(
  machineId: string,
  registryPath: string,
  encoded: string,
): Effect.Effect<Uint8Array, DesktopSavedMachineSecretDecodeError> {
  return Effect.fromResult(Base64.decode(encoded)).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSavedMachineSecretDecodeError({
          machineId,
          registryPath,
          field: "encryptedBearerToken",
          cause,
        }),
    ),
  );
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;

  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;

  return DesktopSavedMachines.of({
    getRegistry: readRegistryDocument(fileSystem, environment.savedMachineRegistryPath).pipe(
      Effect.map((document) =>
        document.records.map((record) => toPersistedSavedMachineRecord(record)),
      ),
      Effect.withSpan("desktop.savedMachines.getRegistry"),
    ),

    getSecret: Effect.fn("desktop.savedMachines.getSecret")(function* (machineId) {
      yield* Effect.annotateCurrentSpan({ machineId });
      const document = yield* readRegistryDocument(
        fileSystem,
        environment.savedMachineRegistryPath,
      );
      const encoded = Option.fromNullishOr(
        document.records.find((record) => record.machineId === machineId)
          ?.encryptedBearerToken,
      );
      if (Option.isNone(encoded)) {
        return Option.none<string>();
      }
      const encryptionAvailable = yield* safeStorage.isEncryptionAvailable.pipe(
        Effect.mapError(
          (cause) =>
            new DesktopSavedMachineSecretProtectionError({
              operation: "check-encryption-availability",
              machineId,
              registryPath: environment.savedMachineRegistryPath,
              cause,
            }),
        ),
      );
      if (!encryptionAvailable) {
        return Option.none<string>();
      }

      const secretBytes = yield* decodeSecretBytes(
        machineId,
        environment.savedMachineRegistryPath,
        encoded.value,
      );
      return Option.some(
        yield* safeStorage.decryptString(secretBytes).pipe(
          Effect.mapError(
            (cause) =>
              new DesktopSavedMachineSecretProtectionError({
                operation: "decrypt-secret",
                machineId,
                registryPath: environment.savedMachineRegistryPath,
                cause,
              }),
          ),
        ),
      );
    }),
  });
});

export const layer = Layer.effect(DesktopSavedMachines, make);
