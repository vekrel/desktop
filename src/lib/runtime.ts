import * as ManagedRuntime from "effect/ManagedRuntime";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Socket from "effect/socket/Socket";

import { layerRemoteHttpClient } from "@vekrel/client-runtime/rpc";
import * as RelayTracing from "@vekrel/shared/relayTracing";
import * as PrimaryMachineHttpClient from "../machines/primary/httpClient";
import * as PrimaryMachineHttpLayer from "../machines/primary/httpLayer";

import * as Dpop from "../cloud/dpop";
import * as ManagedRelayLayer from "../cloud/managedRelayLayer";
import { resolveCloudPublicConfig, resolveRelayTracingConfig } from "../cloud/publicConfig";
import * as ClientTracer from "../observability/clientTracer";

function configuredRelayUrl(): string {
  return resolveCloudPublicConfig().relayUrl ?? "http://relay.invalid";
}

const layerHttpClient = layerRemoteHttpClient((input, init) => globalThis.fetch(input, init));
const layerRelayTracing = RelayTracing.layer(resolveRelayTracingConfig(), {
  serviceName: "vekrel-web",
  serviceVersion: import.meta.env.APP_VERSION,
  runtime: "browser",
  client: typeof window !== "undefined" && window.desktopBridge ? "desktop" : "web",
}).pipe(Layer.provide(layerHttpClient));

type RuntimeLayerSource =
  | typeof layerHttpClient
  | typeof Dpop.layer
  | typeof Socket.layerWebSocketConstructorGlobal
  | typeof layerRelayTracing
  | typeof ClientTracer.layer
  | ReturnType<typeof ManagedRelayLayer.layer>;

const primaryHttpRuntime = ManagedRuntime.make(
  PrimaryMachineHttpClient.layer.pipe(Layer.provide(PrimaryMachineHttpLayer.layer)),
);

export type PrimaryHttpEffectRunner = <A, E>(
  effect: Effect.Effect<A, E, PrimaryMachineHttpClient.PrimaryMachineHttpClient>,
) => Promise<A>;

const livePrimaryHttpRunner: PrimaryHttpEffectRunner = (effect) =>
  primaryHttpRuntime.runPromise(effect);

let primaryHttpRunner = livePrimaryHttpRunner;

export const runPrimaryHttp = <A, E>(
  effect: Effect.Effect<A, E, PrimaryMachineHttpClient.PrimaryMachineHttpClient>,
) => primaryHttpRunner(effect);

export function __setPrimaryHttpRunnerForTests(runner?: PrimaryHttpEffectRunner): void {
  primaryHttpRunner = runner ?? livePrimaryHttpRunner;
}

const layerRuntime = Layer.mergeAll(
  layerHttpClient,
  Dpop.layer,
  Socket.layerWebSocketConstructorGlobal,
  ClientTracer.layer,
  layerRelayTracing,
  ManagedRelayLayer.layer(configuredRelayUrl()).pipe(
    Layer.provide(Layer.mergeAll(layerHttpClient, Dpop.layer)),
  ),
);

export const runtime: ManagedRuntime.ManagedRuntime<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = ManagedRuntime.make(layerRuntime);

export const layer: Layer.Layer<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = Layer.effectContext(runtime.contextEffect);
