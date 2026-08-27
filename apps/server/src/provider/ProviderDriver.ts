/**
 * ProviderDriver / ProviderInstance — driver SPI as plain values.
 *
 * `ProviderDriver` is a record, not a Context.Service. The thing it produces
 * (`ProviderInstance`) is also a record — captured closures owned by that
 * instance, an id, and a driver kind. There are intentionally no per-driver
 * Context tags because tags are singleton-per-runtime and we need many
 * instances of the same driver.
 *
 * The only Effect service involved is `ProviderInstanceRegistry`, which
 * owns the live `Map<InstanceId, ProviderInstance>` and is itself a
 * singleton.
 *
 * Driver factories are functions of `(typed config, env)` where:
 *   - `typed config` is decoded once by the registry via `configSchema`,
 *     so drivers never deal with raw `unknown`.
 *   - `env` flows through Effect's R channel. Each driver declares the
 *     subset of infrastructure services it needs (FileSystem,
 *     ChildProcessSpawner, …) on its `create` return type; the registry
 *     layer's R is the union of those, and the runtime satisfies them once.
 *
 * @module provider/ProviderDriver
 */
import type {
  ProviderDriverKind,
  ProviderInstanceEnvironment,
  ProviderInstanceId,
  ProviderRateLimitResetCreditOutcome,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import type * as TextGeneration from "../textGeneration/TextGeneration.ts";
import type { ProviderAdapterError, ProviderDriverError } from "./Errors.ts";
import type { ProviderAdapterShape } from "./Services/ProviderAdapter.ts";
import type { ServerProviderShape } from "./Services/ServerProvider.ts";

/**
 * Static metadata advertised by a driver. Used for default presentation
 * and (later) settings UI. Doesn't need to be Effect-typed because nothing
 * about it is dynamic — drivers are registered at startup.
 */
export interface ProviderDriverMetadata {
  /** Human-readable name for the driver itself (e.g. "Codex"). */
  readonly displayName: string;
  /**
   * Whether the driver may be instantiated more than once concurrently.
   * Defaults to `true`. Set to `false` for drivers that wrap a global
   * resource (e.g. a single desktop app socket) — the registry then
   * rejects multi-instance configurations with a clear error.
   */
  readonly supportsMultipleInstances?: boolean;
}

export interface ProviderAccountActions {
  /**
   * Consume one earned/banked rate-limit reset for this exact provider
   * instance. The implementation must use the instance's captured account
   * environment (for Codex, its effective CODEX_HOME) and must not fall back
   * to a driver-global/default account.
   */
  readonly consumeRateLimitResetCredit?: (input: {
    readonly idempotencyKey: string;
  }) => Effect.Effect<ProviderRateLimitResetCreditOutcome, ProviderDriverError>;
}

/**
 * One materialized provider instance. Held by the registry, looked up by
 * `instanceId`, torn down by closing the scope it was created in.
 *
 * The runtime fields are captured closures owned by this instance — stopping
 * one instance cannot affect another, and starting a second instance of the
 * same driver does not reach into the first instance's state.
 */
export interface ProviderInstance {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly continuationIdentity: ProviderContinuationIdentity;
  readonly displayName: string | undefined;
  readonly accentColor?: string | undefined;
  readonly enabled: boolean;
  readonly snapshot: ServerProviderShape;
  readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
  readonly textGeneration: TextGeneration.TextGeneration["Service"];
  readonly accountActions?: ProviderAccountActions;
}

export interface ProviderContinuationIdentity {
  readonly driverKind: ProviderDriverKind;
  readonly continuationKey: string;
}

export function defaultProviderContinuationIdentity(input: {
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
}): ProviderContinuationIdentity {
  return {
    driverKind: input.driverKind,
    continuationKey: `${input.driverKind}:instance:${input.instanceId}`,
  };
}

/**
 * Inputs the registry passes to a driver's `create` function.
 * `config` is already decoded by the registry through `configSchema`.
 */
export interface ProviderDriverCreateInput<Config> {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string | undefined;
  readonly accentColor?: string | undefined;
  readonly environment: ProviderInstanceEnvironment;
  readonly enabled: boolean;
  readonly config: Config;
}

/**
 * Driver SPI — registered as a plain value, not a Layer.
 */
export interface ProviderDriver<Config, R = never> {
  readonly driverKind: ProviderDriverKind;
  readonly metadata: ProviderDriverMetadata;
  /**
   * Decoder for the opaque `ProviderInstanceConfig.config` envelope. The
   * registry runs this exactly once per (re)load of an instance; a decode
   * failure is surfaced as `ProviderDriverError` and downgraded to an
   * unavailable shadow snapshot.
   *
   * Using `Codec` rather than `Schema` pins `DecodingServices = never` — if
   * we used `Schema<Config>`, the erased `any` in `AnyProviderDriver` would
   * widen `DecodingServices` to `unknown` and poison the R channel of every
   * caller of `decodeUnknownEffect`.
   */
  readonly configSchema: Schema.Codec<Config, unknown>;
  /** Default typed config for bootstrap / legacy migration paths. */
  readonly defaultConfig: () => Config;
  /**
   * Materialize one instance. The returned effect runs in a scope owned by
   * the registry; closing that scope releases every resource the driver
   * opened. Failures become unavailable shadow snapshots.
   */
  readonly create: (
    input: ProviderDriverCreateInput<Config>,
  ) => Effect.Effect<ProviderInstance, ProviderDriverError, R | Scope.Scope>;
}

/** Heterogeneous-array convenience for registered drivers. */
// `any` intentionally erases each driver's Config after the registry has
// decoded it. `unknown` would make concrete create() inputs unassignable.
export type AnyProviderDriver<R = never> = ProviderDriver<any, R>;
