import { makeMachineHttpApiClient } from "@vekrel/client-runtime/rpc";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { resolvePrimaryMachineHttpUrl } from "./target";

type PrimaryMachineHttpApiClient = Effect.Success<
  ReturnType<typeof makeMachineHttpApiClient>
>;

export interface PrimaryMachineHttpClient {
  readonly PrimaryMachineHttpClient: unique symbol;
}

export const PrimaryMachineHttpClient: Context.Service<
  PrimaryMachineHttpClient,
  PrimaryMachineHttpApiClient
> = Context.Service("@vekrel/web/machines/primary/httpClient/PrimaryMachineHttpClient");

const make = Effect.suspend(() =>
  makeMachineHttpApiClient(resolvePrimaryMachineHttpUrl("/")),
);

export const layer = Layer.effect(PrimaryMachineHttpClient, make);
